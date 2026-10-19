/**
 * SecureMind semantic memory layer.
 *
 * Provides two operations:
 *   storeMemoryFragment  — embed a piece of text and persist it to MemoryFragment
 *   retrieveSemanticMemory — cosine similarity search across stored fragments
 *
 * Embeddings: Ollama nomic-embed-text locally (768-d) or Bedrock Titan v2 in cloud
 * (see EMBED_PROVIDER / src/lib/models/embed.ts). Knowledge ingest is the primary writer.
 * pgvector is required: run scripts/add-vector-embedding.sql once against Neon.
 *
 * All reads/writes of the `embedding` column go through raw SQL because Prisma 7
 * does not support pgvector column types natively (declared Unsupported in schema).
 */

import { db } from "@/lib/db";
import { embedQueryVariants, embedText } from "@/lib/models/embed";
import {
  CANDIDATE_OVERFETCH,
  CANDIDATE_VECTOR_FLOOR,
  rankHits,
} from "@/lib/retrieval-rank";
import { isHostedRuntime, resolveStorageBackend } from "@/lib/runtime-env";
import { hostedAppStore } from "@/lib/workspaces/hosted-dynamo";

import type { ChunkProvenance } from "@/lib/spreadsheet/types";

export type SemanticHit = {
  id:           string;
  content:      string;
  category:     string;
  similarity:   number;   // 0–1 raw vector similarity, higher = more relevant
  /** Share (0–1) of the question's key words found in the chunk. */
  lexical?:     number;
  /** Vector similarity plus the keyword bonus; what retrieval ranks and filters on. */
  score?:       number;
  documentId?:  string | null;
  documentName?: string | null;
  provenance?:  ChunkProvenance | null;
};

/**
 * Evidence thresholds live in `retrieval-rank.ts`: a noise floor for candidates, a lower
 * floor for turns already about the workspace, and a higher one before a general question
 * is upgraded to Knowledge-grounded. A single fixed 0.5 floor dropped correct passages.
 */
export {
  CANDIDATE_VECTOR_FLOOR,
  GROUNDED_MIN_SCORE,
  SPECULATIVE_MIN_SCORE,
} from "@/lib/retrieval-rank";

/** Max fragments fetched from pgvector before evidence selection. */
export const RETRIEVAL_CANDIDATE_LIMIT = 10;
/** Cap workspace-fact scan before scoring so prompt context stays bounded. */
export const WORKSPACE_FACT_RETRIEVAL_LIMIT = 64;
/** Max fragments passed into the final prompt after threshold + dedup. */
export const EVIDENCE_PROMPT_LIMIT = 4;

/**
 * Embeds `content` and stores it as a MemoryFragment scoped to a workspace.
 * The record is created first (so Prisma generates the cuid), then the vector
 * is attached via a raw SQL UPDATE — the only way to write a pgvector column.
 *
 * Throws if Ollama is unreachable or returns a bad vector.
 * The caller should wrap this in a fire-and-forget pattern for non-critical paths.
 */
export async function storeMemoryFragment(opts: {
  content:      string;
  workspaceId?: string;
  sessionId?:   string;
  userId:       string;
  category?:    string;   // "episodic" | "semantic" | "document" — default "episodic"
}): Promise<string> {
  const { content, workspaceId, sessionId, userId, category = "episodic" } = opts;
  if (!userId) throw new Error("userId is required (from getIdentity).");

  // Create the record — Prisma manages the cuid
  const fragment = await db.memoryFragment.create({
    data: { userId, workspaceId, sessionId, content, category },
    select: { id: true },
  });

  // Attach the embedding vector via raw SQL
  const vector = await embedText(content);
  const vectorStr = `[${vector.join(",")}]`;
  await db.$executeRawUnsafe(
    `UPDATE "MemoryFragment" SET embedding = $1::vector WHERE id = $2`,
    vectorStr,
    fragment.id,
  );

  return fragment.id;
}

// Max time to wait for the embedding + retrieval before giving up.
// Keeps TTFT fast even when Ollama is under load or warming up.
const RETRIEVAL_TIMEOUT_MS = 3000;

/**
 * Finds the best Knowledge chunks for `query` in one workspace.
 *
 * Fetches a wider candidate set by vector similarity, adds a keyword bonus, then keeps
 * the best `limit` that clear the grounded floor. Only document chunks are searched, and
 * every row is scoped by userId and workspaceId. On a nomic install the question is
 * embedded both raw and with the query prefix, and each chunk keeps its better score,
 * so chunks stored before task prefixes existed still match.
 *
 * Returns an empty array on any error or timeout — retrieval must never block or break
 * the main chat path.
 */
export async function retrieveSemanticMemory(
  query:       string,
  workspaceId: string,
  userId: string,
  limit  = RETRIEVAL_CANDIDATE_LIMIT,
): Promise<SemanticHit[]> {
  try {
    // Race against a timeout so a slow Ollama embed never delays the chat response
    const vectors = await Promise.race([
      embedQueryVariants(query),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), RETRIEVAL_TIMEOUT_MS)),
    ]);

    if (!vectors) {
      console.warn("[memory] Retrieval timed out — skipping semantic context this turn.");
      return [];
    }

    // $1 userId, $2 workspaceId, $3 candidate count, $4.. one parameter per query vector.
    const distances = vectors.map((_, i) => `(mf.embedding <=> $${i + 4}::vector)`);
    const nearest = distances.length === 1 ? distances[0] : `LEAST(${distances.join(", ")})`;

    // Citeable Knowledge only: approved document chunks. Episodic/assistant
    // fragments must never surface as Sources or prompt evidence.
    const rows = await db.$queryRawUnsafe<(SemanticHit & { provenance: unknown })[]>(
      `SELECT mf.id, mf.content, mf.category, mf."documentId",
              d.name AS "documentName",
              mf.provenance,
              1 - ${nearest} AS similarity
       FROM   "MemoryFragment" mf
       INNER JOIN "Document" d ON d.id = mf."documentId"
       WHERE  mf."userId"      = $1
         AND  mf."workspaceId" = $2
         AND  mf.category      = 'document'
         AND  mf.embedding     IS NOT NULL
       ORDER BY ${nearest}
       LIMIT  $3`,
      userId,
      workspaceId,
      Math.max(1, limit) * CANDIDATE_OVERFETCH,
      ...vectors.map(v => `[${v.join(",")}]`),
    );

    const candidates = rows
      .map(h => ({
        ...h,
        similarity: Number(h.similarity),
        provenance: (h.provenance && typeof h.provenance === "object")
          ? h.provenance as ChunkProvenance
          : null,
      }))
      .filter(h => h.similarity >= CANDIDATE_VECTOR_FLOOR);
    return rankHits(candidates, query, limit);
  } catch (err) {
    // Semantic retrieval failure must never break the main chat path
    console.warn("[memory] Retrieval failed — continuing without semantic context:", String(err));
    return [];
  }
}

export type CombinedContext = {
  documentHits: SemanticHit[];
  facts: { key: string; value: string; pinned: boolean; score: number }[];
};

function factScore(query: string, key: string, value: string, pinned: boolean): number {
  const q = query.toLowerCase();
  const hay = `${key} ${value}`.toLowerCase();
  const terms = q.split(/[^a-z0-9]+/).filter(t => t.length > 2);
  let hits = 0;
  for (const t of terms) if (hay.includes(t)) hits++;
  const overlap = terms.length ? hits / terms.length : 0;
  return overlap + (pinned ? 0.25 : 0);
}

async function retrieveDocumentHits(
  query: string,
  workspaceId: string,
  userId: string,
  limit: number,
) {
  if (isHostedRuntime() || resolveStorageBackend() === "dynamodb") {
    const { getDynamoVectors } = await import("@/lib/storage/dynamodb-vectors");
    return getDynamoVectors().retrieve({ query, workspaceId, userId, limit });
  }
  return retrieveSemanticMemory(query, workspaceId, userId, limit);
}

/**
 * Combine Knowledge vector hits with eligible workspace facts.
 * Facts are never citeable — they only rank into the prompt as user-stated context.
 */
export async function retrieveCombinedContext(opts: {
  query: string;
  workspaceId: string;
  userId: string;
  clientFacts?: Record<string, string>;
  limit?: number;
}): Promise<CombinedContext> {
  const limit = opts.limit ?? RETRIEVAL_CANDIDATE_LIMIT;
  const documentHits = limit <= 0
    ? []
    : await retrieveDocumentHits(opts.query, opts.workspaceId, opts.userId, limit);

  type FactRow = { key: string; value: string; pinned: boolean; updatedAt: Date };
  let rows: FactRow[] = [];
  try {
    if (isHostedRuntime() || resolveStorageBackend() === "dynamodb") {
      const facts = await hostedAppStore().listFacts(opts.userId, opts.workspaceId);
      rows = facts
        .filter(f => !f.forgotten)
        .map(f => ({
          key: f.key,
          value: f.value,
          pinned: f.pinned,
          updatedAt: new Date(f.updatedAt),
        }));
    } else {
      rows = await db.workspaceFact.findMany({
        where: { workspaceId: opts.workspaceId, forgotten: false },
        select: { key: true, value: true, pinned: true, updatedAt: true },
        orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
        take: WORKSPACE_FACT_RETRIEVAL_LIMIT,
      });
    }
  } catch (err) {
    console.warn(
      "[memory] workspace facts unavailable",
      err instanceof Error ? err.message : err,
    );
  }

  const merged = new Map<string, { value: string; pinned: boolean; updatedAt: number }>();
  for (const [key, value] of Object.entries(opts.clientFacts ?? {})) {
    if (value) merged.set(key, { value, pinned: false, updatedAt: 0 });
  }
  for (const row of rows) {
    merged.set(row.key, {
      value: row.value,
      pinned: row.pinned,
      updatedAt: row.updatedAt.getTime(),
    });
  }

  const facts = [...merged.entries()]
    .map(([key, row]) => ({
      key,
      value: row.value,
      pinned: row.pinned,
      score: factScore(opts.query, key, row.value, row.pinned) + Math.min(0.1, row.updatedAt / 1e15),
    }))
    .filter(f => f.pinned || f.score > 0 || merged.size <= 8)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);

  return { documentHits, facts };
}
