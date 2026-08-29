/**
 * DynamoDB-backed Knowledge fragment store (hosted AWS path).
 * Default `npm run dev` stays on Postgres; set STORAGE_BACKEND=dynamodb to use this.
 *
 * Must not import `@/lib/db`. Isolation is enforced here from caller-supplied
 * userId (which must come from getIdentity) plus workspaceId + category filters.
 */

import { expectedEmbedDimensions } from "@/lib/models/embed";
import type { ChunkProvenance } from "@/lib/spreadsheet/types";
import type { VectorHit, VectorSearchRepository } from "./contracts";
import { assertEmbeddingDimensions } from "./dynamodb-schema";
import { createDynamoDbVectorEngine } from "./dynamodb-client-engine";
import { createInMemoryVectorEngine, type VectorEngine } from "./vector-engine";
import { clampTopK } from "./vector-math";

const DOCUMENT_CATEGORY = "document";
const RETRIEVAL_TIMEOUT_MS = 3000;
const DEFAULT_MIN_SIMILARITY = 0.5;

export type VectorFragmentWrite = {
  id: string;
  userId: string;
  workspaceId: string;
  content: string;
  category?: string;
  embedding: number[];
  documentId: string;
  documentName: string;
  provenance?: ChunkProvenance | null;
};

export interface VectorFragmentRepository extends VectorSearchRepository {
  put(item: VectorFragmentWrite): Promise<void>;
  deleteOwned(opts: {
    workspaceId: string;
    userId: string;
    fragmentIds: string[];
  }): Promise<number>;
}

export type DynamoVectorRepoDeps = {
  engine: VectorEngine;
  embed: (text: string) => Promise<number[]>;
  dimensions: number;
  minSimilarity?: number;
};

function parseProvenance(raw: string | null): ChunkProvenance | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as ChunkProvenance;
    if (v && typeof v === "object" && typeof v.kind === "string") return v;
  } catch {
    /* ignore malformed */
  }
  return null;
}

export function createDynamoVectorRepository(deps: DynamoVectorRepoDeps): VectorFragmentRepository {
  const minSimilarity = deps.minSimilarity ?? DEFAULT_MIN_SIMILARITY;

  return {
    async put(item) {
      assertEmbeddingDimensions(item.embedding, deps.dimensions);
      if (!item.workspaceId) {
        throw new Error("workspaceId is required so the fragment is indexed for SearchVectors.");
      }
      if (!item.userId) {
        throw new Error("userId is required for tenant-scoped retrieval.");
      }
      await deps.engine.put({
        workspaceId: item.workspaceId,
        fragmentId: item.id,
        userId: item.userId,
        category: item.category ?? DOCUMENT_CATEGORY,
        content: item.content,
        documentId: item.documentId,
        documentName: item.documentName,
        provenanceJson: item.provenance ? JSON.stringify(item.provenance) : null,
        embedding: item.embedding,
      });
    },

    async deleteOwned({ workspaceId, userId, fragmentIds }) {
      let n = 0;
      for (const fragmentId of fragmentIds) {
        if (await deps.engine.deleteOwned({ workspaceId, fragmentId, userId })) n++;
      }
      return n;
    },

    async retrieve({ query, workspaceId, userId, limit }) {
      try {
        const vectorResult = await Promise.race([
          deps.embed(query),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), RETRIEVAL_TIMEOUT_MS)),
        ]);
        if (!vectorResult) return [];
        assertEmbeddingDimensions(vectorResult, deps.dimensions);
        const hits = await deps.engine.search({
          vector: vectorResult,
          workspaceId,
          userId,
          category: DOCUMENT_CATEGORY,
          topK: clampTopK(limit),
        });
        return hits
          .filter((h) => h.similarity >= minSimilarity)
          .map((h): VectorHit => ({
            id: h.record.fragmentId,
            content: h.record.content,
            category: h.record.category,
            similarity: h.similarity,
            documentId: h.record.documentId,
            documentName: h.record.documentName,
            provenance: parseProvenance(h.record.provenanceJson),
          }));
      } catch (err) {
        console.warn("[dynamodb-vectors] Retrieval failed — continuing without semantic context:", String(err));
        return [];
      }
    },
  };
}

let singleton: VectorFragmentRepository | null = null;

export function dynamoVectorsFromEnv(): VectorFragmentRepository {
  const engineName = (process.env.DYNAMODB_VECTOR_ENGINE ?? "").toLowerCase().trim();
  const engine =
    engineName === "memory" ? createInMemoryVectorEngine() : createDynamoDbVectorEngine();
  return createDynamoVectorRepository({
    engine,
    embed: (text) => import("@/lib/models/embed").then((m) => m.embedText(text)),
    dimensions: expectedEmbedDimensions(),
  });
}

/** Lazy app singleton. Tests should call createDynamoVectorRepository instead. */
export function getDynamoVectors(): VectorFragmentRepository {
  if (!singleton) singleton = dynamoVectorsFromEnv();
  return singleton;
}

export function resetDynamoVectorsForTests(): void {
  singleton = null;
}
