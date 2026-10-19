/**
 * Re-embed stored Knowledge chunks with the nomic document prefix.
 *
 * Chunks ingested before task prefixes existed were embedded as raw text. Retrieval
 * still finds them (it searches with both query forms), but a prefixed chunk matches a
 * prefixed question noticeably better, so operators can re-index to lift old documents.
 * It works from the stored, already-scrubbed chunk text, so the original files are not
 * needed and nothing is re-scanned. Safe to run more than once.
 *
 * Postgres (local) only. Hosted installs embed with Titan, which takes no prefix.
 *
 * Every statement filters by userId: this raw SQL touches MemoryFragment, the one table
 * where a tenant boundary could be crossed silently.
 */

import { embedderUsesTaskPrefixes } from "@/lib/models/embed";

export type ReindexDeps = {
  listChunks: (opts: {
    userId: string;
    workspaceId?: string;
    afterId: string;
    take: number;
  }) => Promise<{ id: string; content: string }[]>;
  updateEmbedding: (opts: { id: string; userId: string; vector: number[] }) => Promise<void>;
  embedDocument: (text: string) => Promise<number[]>;
  usesPrefixes: () => boolean;
};

export type ReindexResult = {
  reindexed: number;
  failed: number;
  skipped?: string;
};

export const REINDEX_BATCH = 50;

async function defaultDeps(): Promise<ReindexDeps> {
  const { db } = await import("@/lib/db");
  const { embedDocumentText } = await import("@/lib/models/embed");
  return {
    async listChunks({ userId, workspaceId, afterId, take }) {
      return db.memoryFragment.findMany({
        where: {
          userId,
          category: "document",
          id: { gt: afterId },
          ...(workspaceId ? { workspaceId } : {}),
        },
        orderBy: { id: "asc" },
        take,
        select: { id: true, content: true },
      });
    },
    async updateEmbedding({ id, userId, vector }) {
      await db.$executeRawUnsafe(
        `UPDATE "MemoryFragment" SET embedding = $1::vector WHERE id = $2 AND "userId" = $3`,
        `[${vector.join(",")}]`,
        id,
        userId,
      );
    },
    embedDocument: embedDocumentText,
    usesPrefixes: embedderUsesTaskPrefixes,
  };
}

export async function reindexKnowledgeEmbeddings(
  opts: { userId: string; workspaceId?: string; onProgress?: (done: number) => void },
  deps?: ReindexDeps,
): Promise<ReindexResult> {
  const d = deps ?? (await defaultDeps());
  if (!opts.userId) throw new Error("userId is required to re-index Knowledge.");
  if (!d.usesPrefixes()) {
    return { reindexed: 0, failed: 0, skipped: "The active embedding model takes no task prefixes." };
  }

  let reindexed = 0;
  let failed = 0;
  let afterId = "";
  for (;;) {
    const chunks = await d.listChunks({
      userId: opts.userId,
      workspaceId: opts.workspaceId,
      afterId,
      take: REINDEX_BATCH,
    });
    if (chunks.length === 0) break;
    for (const chunk of chunks) {
      afterId = chunk.id;
      try {
        const vector = await d.embedDocument(chunk.content);
        await d.updateEmbedding({ id: chunk.id, userId: opts.userId, vector });
        reindexed++;
      } catch {
        failed++;
      }
    }
    opts.onProgress?.(reindexed);
  }
  return { reindexed, failed };
}
