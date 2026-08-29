/**
 * Vector engines behind the DynamoDB fragment repository.
 * Tests inject the in-memory engine. Floci uses Query + cosine.
 * Hosted AWS uses SearchVectors when the SDK/table support it.
 */

import {
  cosineSimilarity,
  similarityFromCosineScore,
  clampTopK,
} from "./vector-math";
import type { DynamoFragmentRecord } from "./dynamodb-schema";

export type VectorSearchHit = {
  record: DynamoFragmentRecord;
  similarity: number;
};

export type VectorEngineSearch = {
  vector: number[];
  workspaceId: string;
  userId: string;
  category: string;
  topK: number;
};

export interface VectorEngine {
  put(record: DynamoFragmentRecord): Promise<void>;
  search(opts: VectorEngineSearch): Promise<VectorSearchHit[]>;
  deleteOwned(opts: {
    workspaceId: string;
    fragmentId: string;
    userId: string;
  }): Promise<boolean>;
}

function matchesScope(record: DynamoFragmentRecord, opts: VectorEngineSearch): boolean {
  return (
    record.workspaceId === opts.workspaceId &&
    record.userId === opts.userId &&
    record.category === opts.category
  );
}

export function rankByCosine(
  records: DynamoFragmentRecord[],
  opts: VectorEngineSearch,
): VectorSearchHit[] {
  const topK = clampTopK(opts.topK);
  const hits: VectorSearchHit[] = [];
  for (const record of records) {
    if (!matchesScope(record, opts)) continue;
    if (record.embedding.length !== opts.vector.length) continue;
    const similarity = cosineSimilarity(opts.vector, record.embedding);
    hits.push({ record, similarity });
  }
  hits.sort((a, b) => b.similarity - a.similarity);
  return hits.slice(0, topK);
}

/** In-process store with the same ranking as a COSINE SearchVectors fallback. */
export function createInMemoryVectorEngine(): VectorEngine {
  const byWorkspace = new Map<string, Map<string, DynamoFragmentRecord>>();

  return {
    async put(record) {
      let bucket = byWorkspace.get(record.workspaceId);
      if (!bucket) {
        bucket = new Map();
        byWorkspace.set(record.workspaceId, bucket);
      }
      bucket.set(record.fragmentId, { ...record, embedding: record.embedding.slice() });
    },
    async search(opts) {
      const bucket = byWorkspace.get(opts.workspaceId);
      return rankByCosine(bucket ? [...bucket.values()] : [], opts);
    },
    async deleteOwned({ workspaceId, fragmentId, userId }) {
      const bucket = byWorkspace.get(workspaceId);
      const existing = bucket?.get(fragmentId);
      if (!existing || existing.userId !== userId) return false;
      bucket!.delete(fragmentId);
      return true;
    },
  };
}

/**
 * Rank items already loaded from a workspace partition (Query fallback).
 * Caller must still pass userId/category — this is not an access-control boundary.
 */
export function cosineHitsFromPartition(
  records: DynamoFragmentRecord[],
  opts: VectorEngineSearch,
): VectorSearchHit[] {
  return rankByCosine(records, opts);
}

/** Map an AWS COSINE SearchVectors score onto the same similarity the fallback uses. */
export function hitFromSearchVectorsScore(
  record: DynamoFragmentRecord,
  cosineScore: number,
): VectorSearchHit {
  return { record, similarity: similarityFromCosineScore(cosineScore) };
}
