/**
 * Storage ports shared by the Postgres local edition and DynamoDB hosted edition.
 * Implementations may use native APIs; callers depend only on these shapes.
 */

import type { ChunkProvenance } from "@/lib/spreadsheet/types";

export type KnowledgeRecord = {
  id: string;
  userId: string;
  workspaceId: string | null;
  name: string;
  mimeType: string;
  sizeBytes: number;
  content: string;
  status: "processing" | "ready" | "failed";
  chunkCount: number;
  redactionCount: number;
  processingError: string | null;
  storageKey: string | null;
  extractMeta: unknown;
  createdAt: Date;
};

export type KnowledgeListItem = Omit<KnowledgeRecord, "content"> & {
  contentPreview: string;
};

export type MemoryFactRecord = {
  id: string;
  workspaceId: string;
  userId: string;
  key: string;
  value: string;
  confidence: number;
  source: string | null;
  pinned: boolean;
  forgotten: boolean;
  updatedAt: Date;
};

export type VectorHit = {
  id: string;
  content: string;
  category: string;
  /** Raw vector similarity (0–1). */
  similarity: number;
  /** Share (0–1) of the question's key words found in the chunk. */
  lexical?: number;
  /** Vector similarity plus the keyword bonus; what retrieval ranks and filters on. */
  score?: number;
  documentId?: string | null;
  documentName?: string | null;
  provenance?: ChunkProvenance | null;
};

export interface KnowledgeRepository {
  listForUser(userId: string, workspaceId?: string | null): Promise<KnowledgeListItem[]>;
  getOwned(id: string, userId: string): Promise<KnowledgeRecord | null>;
  deleteOwned(id: string, userId: string): Promise<boolean>;
}

export interface MemoryRepository {
  listFacts(userId: string, workspaceId: string): Promise<MemoryFactRecord[]>;
  patchFact(
    userId: string,
    workspaceId: string,
    factId: string,
    patch: { value?: string; pinned?: boolean; forgotten?: boolean },
  ): Promise<MemoryFactRecord | null>;
  deleteFact(userId: string, workspaceId: string, factId: string): Promise<boolean>;
}

export interface VectorSearchRepository {
  retrieve(opts: {
    query: string;
    workspaceId: string;
    userId: string;
    limit?: number;
  }): Promise<VectorHit[]>;
}

export interface CredentialMetadataRepository {
  hasEncryptedInstanceSecrets(): Promise<boolean>;
}
