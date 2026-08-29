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

export function expectedEmbedDimensions(): number {
  return embedDimensions();
}
