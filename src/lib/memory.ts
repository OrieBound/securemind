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
import { embedText } from "@/lib/models/embed";

import type { ChunkProvenance } from "@/lib/spreadsheet/types";

export type SemanticHit = {
  id:           string;
  content:      string;
  category:     string;
  similarity:   number;   // 0–1, higher = more relevant
  documentId?:  string | null;
  documentName?: string | null;
  provenance?:  ChunkProvenance | null;
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

    // Citeable Knowledge only: approved document chunks. Episodic/assistant
    // fragments must never surface as Sources or prompt evidence.
    const hits = await db.$queryRawUnsafe<(SemanticHit & { provenance: unknown })[]>(
      `SELECT mf.id, mf.content, mf.category, mf."documentId",
              d.name AS "documentName",
              mf.provenance,
              1 - (mf.embedding <=> $1::vector) AS similarity
       FROM   "MemoryFragment" mf
       INNER JOIN "Document" d ON d.id = mf."documentId"
       WHERE  mf."userId"      = $2
         AND  mf."workspaceId" = $3
         AND  mf.category      = 'document'
         AND  mf.embedding     IS NOT NULL
       ORDER BY mf.embedding <=> $1::vector
       LIMIT  $4`,
      vectorStr,
      userId,
      workspaceId,
      limit,
    );

    return hits
      .filter(h => Number(h.similarity) >= MIN_SIMILARITY)
      .map(h => ({
        ...h,
        provenance: (h.provenance && typeof h.provenance === "object")
          ? h.provenance as ChunkProvenance
          : null,
      }));
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
  const { resolveStorageBackend } = await import("@/lib/runtime-env");
  if (resolveStorageBackend() === "dynamodb") {
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

  const rows = await db.workspaceFact.findMany({
    where: { workspaceId: opts.workspaceId, forgotten: false },
    select: { key: true, value: true, pinned: true, updatedAt: true },
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
    take: WORKSPACE_FACT_RETRIEVAL_LIMIT,
  });

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
