/**
 * Dual-write Knowledge chunks into DynamoDB when STORAGE_BACKEND=dynamodb.
 * Postgres remains the document/metadata store (listing, delete cascade).
 */

import { resolveStorageBackend } from "@/lib/runtime-env";
import type { ChunkProvenance } from "@/lib/spreadsheet/types";
import { getDynamoVectors, type VectorFragmentRepository } from "./dynamodb-vectors";

export async function mirrorDocumentChunkToDynamo(
  opts: {
    fragmentId: string;
    userId: string;
    workspaceId: string | null | undefined;
    content: string;
    embedding: number[];
    documentId: string;
    documentName: string;
    provenance?: ChunkProvenance | null;
  },
  repo: VectorFragmentRepository = getDynamoVectors(),
): Promise<boolean> {
  if (resolveStorageBackend() !== "dynamodb") return false;
  if (!opts.workspaceId) return false;
  await repo.put({
    id: opts.fragmentId,
    userId: opts.userId,
    workspaceId: opts.workspaceId,
    content: opts.content,
    embedding: opts.embedding,
    documentId: opts.documentId,
    documentName: opts.documentName,
    provenance: opts.provenance ?? null,
  });
  return true;
}

export async function purgeDocumentChunksFromDynamo(
  opts: {
    userId: string;
    workspaceId: string | null | undefined;
    fragmentIds: string[];
  },
  repo: VectorFragmentRepository = getDynamoVectors(),
): Promise<number> {
  if (resolveStorageBackend() !== "dynamodb") return 0;
  if (!opts.workspaceId || opts.fragmentIds.length === 0) return 0;
  return repo.deleteOwned({
    workspaceId: opts.workspaceId,
    userId: opts.userId,
    fragmentIds: opts.fragmentIds,
  });
}
