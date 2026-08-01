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
  id:         string;
  content:    string;
  category:   string;
  similarity: number;   // 0–1, higher = more relevant
};

// Minimum similarity threshold — hits below this are too noisy to be useful
const MIN_SIMILARITY = 0.35;

/**
 * Embeds `content` and stores it as a MemoryFragment scoped to the given agent.
 * The record is created first (so Prisma generates the cuid), then the vector
 * is attached via a raw SQL UPDATE — the only way to write a pgvector column.
 *
 * Throws if Ollama is unreachable or returns a bad vector.
 * The caller should wrap this in a fire-and-forget pattern for non-critical paths.
 */
export async function storeMemoryFragment(opts: {
  content:     string;
  agentId?:    string;
  sessionId?:  string;
  userId?:     string;
  category?:   string;   // "episodic" | "semantic" | "document" — default "episodic"
}): Promise<string> {
  const { content, agentId, sessionId, userId = "local", category = "episodic" } = opts;

  // Create the record — Prisma manages the cuid
  const fragment = await db.memoryFragment.create({
    data: { userId, agentId, sessionId, content, category },
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
 * Searches only the requesting agent's fragments (episodic, semantic, and
 * document chunks). Documents uploaded under a companion are stamped with
 * that companion's agentId when processed, so a single agentId filter covers
 * all memory types — full per-companion isolation.
 *
 * Returns an empty array on any error or timeout — semantic retrieval must
 * never block or break the main chat path.
 */
export async function retrieveSemanticMemory(
  query:   string,
  agentId: string,
  userId = "local",
  limit  = 6,
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

    // All fragment types (episodic, semantic, document) are scoped to the agent
    const hits = await db.$queryRawUnsafe<SemanticHit[]>(
      `SELECT id, content, category,
              1 - (embedding <=> $1::vector) AS similarity
       FROM   "MemoryFragment"
       WHERE  "userId"   = $2
         AND  "agentId"  = $3
         AND  embedding  IS NOT NULL
       ORDER BY embedding <=> $1::vector
       LIMIT  $4`,
      vectorStr,
      userId,
      agentId,
      limit,
    );

    return hits.filter(h => Number(h.similarity) >= MIN_SIMILARITY);
  } catch (err) {
    // Semantic retrieval failure must never break the main chat path
    console.warn("[memory] Retrieval failed — continuing without semantic context:", String(err));
    return [];
  }
}
