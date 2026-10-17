/**
 * Unified text embeddings.
 *
 * Local: Ollama nomic-embed-text (768-d) via EMBED_PROVIDER=ollama (default).
 * Cloud: Bedrock Titan Text Embeddings V2 — set EMBED_PROVIDER=bedrock and
 * EMBED_DIMENSIONS to match the pgvector column (default 1024 for Titan v2).
 * Migrating off 768 requires altering MemoryFragment.embedding (see infra docs).
 */

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { withRealAwsEndpoints } from "@/lib/aws-credentials";
import { resolveEmbedProvider } from "@/lib/runtime-env";
import { embedText as embedOllama } from "@/lib/models/ollama";

const DEFAULT_BEDROCK_EMBED_MODEL =
  process.env.BEDROCK_EMBED_MODEL ?? "amazon.titan-embed-text-v2:0";

function embedDimensions(): number {
  const n = Number(process.env.EMBED_DIMENSIONS ?? "0");
  if (Number.isFinite(n) && n > 0) return n;
  return resolveEmbedProvider() === "bedrock" ? 1024 : 768;
}

async function embedBedrock(text: string): Promise<number[]> {
  const dimensions = embedDimensions();
  const body = JSON.stringify({
    inputText: text.slice(0, 8000),
    dimensions,
    normalize: true,
  });

  return withRealAwsEndpoints(async () => {
    const region =
      process.env.BEDROCK_REGION ||
      process.env.AWS_REGION ||
      process.env.AWS_DEFAULT_REGION ||
      "us-east-1";
    const client = new BedrockRuntimeClient({ region });
    const out = await client.send(
      new InvokeModelCommand({
        modelId: DEFAULT_BEDROCK_EMBED_MODEL,
        contentType: "application/json",
        accept: "application/json",
        body: new TextEncoder().encode(body),
      }),
    );
    const raw = out.body ? new TextDecoder().decode(out.body) : "{}";
    const parsed = JSON.parse(raw) as { embedding?: number[] };
    if (!Array.isArray(parsed.embedding) || parsed.embedding.length === 0) {
      throw new Error("Bedrock embed returned an empty or malformed vector.");
    }
    if (parsed.embedding.length !== dimensions) {
      throw new Error(
        `Bedrock embed returned ${parsed.embedding.length} dims; expected ${dimensions}. ` +
          `Set EMBED_DIMENSIONS and align the pgvector column.`,
      );
    }
    return parsed.embedding;
  });
}

/** Dense embedding for semantic memory / document chunks. */
export async function embedText(text: string): Promise<number[]> {
  const provider = resolveEmbedProvider();
  if (provider === "bedrock") return embedBedrock(text);
  return embedOllama(text);
}

/** nomic-embed-text is trained with task prefixes. Titan and other models take none. */
export const NOMIC_DOCUMENT_PREFIX = "search_document: ";
export const NOMIC_QUERY_PREFIX = "search_query: ";

/** True when the active embedder is a nomic model that expects task prefixes. */
export function embedderUsesTaskPrefixes(): boolean {
  if (resolveEmbedProvider() === "bedrock") return false;
  return /nomic-embed/i.test(process.env.OLLAMA_EMBED_MODEL ?? "nomic-embed-text");
}

/** Embed a chunk of a document that is being stored for retrieval. */
export async function embedDocumentText(text: string): Promise<number[]> {
  return embedText(embedderUsesTaskPrefixes() ? NOMIC_DOCUMENT_PREFIX + text : text);
}

/**
 * Query vectors to search with. Chunks stored before task prefixes were added were
 * embedded as raw text, so a nomic install searches with both the raw and the
 * prefixed query and keeps each chunk's better score. Old and new chunks therefore
 * work side by side with no migration. Other embedders return a single vector.
 */
export async function embedQueryVariants(text: string): Promise<number[][]> {
  if (!embedderUsesTaskPrefixes()) return [await embedText(text)];
  return Promise.all([embedText(text), embedText(NOMIC_QUERY_PREFIX + text)]);
}

export function expectedEmbedDimensions(): number {
  return embedDimensions();
}
