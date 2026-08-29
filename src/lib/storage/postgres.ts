/**
 * Postgres + pgvector implementations of the storage contracts.
 * Routes should prefer these ports; Prisma stays inside this module and domain helpers.
 */

import { db } from "@/lib/db";
import { retrieveSemanticMemory } from "@/lib/memory";
import { isEncryptedSecret } from "@/lib/secret-at-rest";
import type {
  CredentialMetadataRepository,
  KnowledgeListItem,
  KnowledgeRecord,
  KnowledgeRepository,
  MemoryFactRecord,
  MemoryRepository,
  VectorSearchRepository,
} from "./contracts";

function asStatus(value: string): KnowledgeRecord["status"] {
  if (value === "ready" || value === "failed" || value === "processing") return value;
  return "processing";
}

export const postgresKnowledge: KnowledgeRepository = {
  async listForUser(userId, workspaceId) {
    const rows = await db.document.findMany({
      where: {
        userId,
        ...(workspaceId ? { OR: [{ workspaceId }, { workspaceId: null }] } : {}),
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        userId: true,
        workspaceId: true,
        name: true,
        mimeType: true,
        sizeBytes: true,
        status: true,
        chunkCount: true,
        redactionCount: true,
        processingError: true,
        storageKey: true,
        extractMeta: true,
        createdAt: true,
      },
    });
    return rows.map((rest): KnowledgeListItem => ({
      ...rest,
      status: asStatus(rest.status),
      contentPreview: "",
    }));
  },

  async getOwned(id, userId) {
    const row = await db.document.findFirst({ where: { id, userId } });
    if (!row) return null;
    return { ...row, status: asStatus(row.status) };
  },

  async deleteOwned(id, userId) {
    const owned = await db.document.findFirst({ where: { id, userId }, select: { id: true } });
    if (!owned) return false;
    await db.document.delete({ where: { id } });
    return true;
  },
};

function mapFact(row: {
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
}): MemoryFactRecord {
  return row;
}

export const postgresMemory: MemoryRepository = {
  async listFacts(userId, workspaceId) {
    const owned = await db.workspace.findFirst({
      where: { id: workspaceId, userId },
      select: { id: true },
    });
    if (!owned) return [];
    const rows = await db.workspaceFact.findMany({
      where: { workspaceId },
      orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
      take: 80,
    });
    return rows.map(mapFact);
  },

  async patchFact(userId, workspaceId, factId, patch) {
    const owned = await db.workspace.findFirst({
      where: { id: workspaceId, userId },
      select: { id: true },
    });
    if (!owned) return null;
    const existing = await db.workspaceFact.findFirst({
      where: { id: factId, workspaceId },
    });
    if (!existing) return null;
    const data: Record<string, unknown> = {
      correctedAt: new Date(),
      correctedByUserId: userId,
    };
    if (typeof patch.value === "string") data.value = patch.value;
    if (typeof patch.pinned === "boolean") data.pinned = patch.pinned;
    if (typeof patch.forgotten === "boolean") data.forgotten = patch.forgotten;
    const updated = await db.workspaceFact.update({ where: { id: factId }, data });
    return mapFact(updated);
  },

  async deleteFact(userId, workspaceId, factId) {
    const owned = await db.workspace.findFirst({
      where: { id: workspaceId, userId },
      select: { id: true },
    });
    if (!owned) return false;
    const existing = await db.workspaceFact.findFirst({
      where: { id: factId, workspaceId },
      select: { id: true },
    });
    if (!existing) return false;
    await db.workspaceFact.delete({ where: { id: factId } });
    return true;
  },
};

export const postgresVectors: VectorSearchRepository = {
  async retrieve({ query, workspaceId, userId, limit }) {
    return retrieveSemanticMemory(query, workspaceId, userId, limit);
  },
};

export const postgresCredentialMeta: CredentialMetadataRepository = {
  async hasEncryptedInstanceSecrets() {
    const row = await db.instanceConfig.findUnique({
      where: { id: "singleton" },
      select: { groqApiKey: true },
    });
    return isEncryptedSecret(row?.groqApiKey);
  },
};
