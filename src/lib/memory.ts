/**
 * SecureMind semantic memory layer (Phase B).
 *
 * Provides two operations:
 *   storeMemoryFragment  — embed a piece of text and persist it to MemoryFragment
 *   retrieveSemanticMemory — cosine similarity search across stored fragments
 *
 * The embedding model is nomic-embed-text (Ollama local, zero cost, 768 dims).
 * pgvector is required: run scripts/add-vector-embedding.sql once against Neon.
 *
 * All reads/writes of the `embedding` column go through raw SQL because Prisma 7
 * does not support pgvector column types natively (declared Unsupported in schema).
 */

import { db } from "@/lib/db";
import { embedText } from "@/lib/models/ollama";

export type SemanticHit = {
  id:           string;
  content:      string;
  category:     string;
  similarity:   number;   // 0–1, higher = more relevant
  documentId?:  string | null;
  documentName?: string | null;
};

/**
 * Minimum cosine similarity for a chunk to enter the model prompt as evidence.
 * Candidates may be fetched with a slightly lower floor for diagnostics later;
 * prompt inclusion uses this calibrated threshold.
 */
export const EVIDENCE_MIN_SIMILARITY = 0.5;
/** @deprecated use EVIDENCE_MIN_SIMILARITY */
const MIN_SIMILARITY = EVIDENCE_MIN_SIMILARITY;

/** Max fragments fetched from pgvector before evidence selection. */
export const RETRIEVAL_CANDIDATE_LIMIT = 10;
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
  userId?:      string;
  category?:    string;   // "episodic" | "semantic" | "document" — default "episodic"
}): Promise<string> {
  const { content, workspaceId, sessionId, userId = "local", category = "episodic" } = opts;

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
 * Finds the top-k MemoryFragments most semantically similar to `query`.
 *
 * Searches only the requesting workspace's fragments (episodic, semantic, and
 * document chunks). Documents uploaded into a workspace are stamped with that
 * workspaceId when processed, so a single workspaceId filter covers all memory
 * types — full per-workspace isolation.
 *
 * Returns an empty array on any error or timeout — semantic retrieval must
 * never block or break the main chat path.
 */
export async function retrieveSemanticMemory(
  query:       string,
  workspaceId: string,
  userId = "local",
  limit  = RETRIEVAL_CANDIDATE_LIMIT,
): Promise<SemanticHit[]> {
  try {
    // Race against a timeout so a slow Ollama embed never delays the chat response
    const vectorResult = await Promise.race([
      embedText(query),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), RETRIEVAL_TIMEOUT_MS)),
    ]);

    if (!vectorResult) {
      console.warn("[memory] Retrieval timed out — skipping semantic context this turn.");
      return [];
    }

    const vectorStr = `[${vectorResult.join(",")}]`;

    // All fragment types (episodic, semantic, document) are scoped to the workspace.
    // LEFT JOIN Document so citation UI can show the source filename.
    const hits = await db.$queryRawUnsafe<SemanticHit[]>(
      `SELECT mf.id, mf.content, mf.category, mf."documentId",
              d.name AS "documentName",
              1 - (mf.embedding <=> $1::vector) AS similarity
       FROM   "MemoryFragment" mf
       LEFT JOIN "Document" d ON d.id = mf."documentId"
       WHERE  mf."userId"      = $2
         AND  mf."workspaceId" = $3
         AND  mf.embedding     IS NOT NULL
       ORDER BY mf.embedding <=> $1::vector
       LIMIT  $4`,
      vectorStr,
      userId,
      workspaceId,
      limit,
    );

    return hits.filter(h => Number(h.similarity) >= MIN_SIMILARITY);
  } catch (err) {
    // Semantic retrieval failure must never break the main chat path
    console.warn("[memory] Retrieval failed — continuing without semantic context:", String(err));
    return [];
  }
}
