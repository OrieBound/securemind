/**
 * Document metadata persistence. Local: Prisma. Hosted: Dynamo app records.
 * Original bytes stay on local disk only — Amplify has no durable upload volume.
 */

import { db } from "@/lib/db";
import { INTERRUPTED_CODE, isStaleProcessing } from "@/lib/documents/stale-processing";
import { usesHostedAppStore } from "@/lib/workspaces/store";
import {
  hostedAppStore,
  type HostedDocument,
  type HostedDocumentChunk,
} from "@/lib/workspaces/hosted-dynamo";

export type PersistedDocument = {
  id: string;
  userId: string;
  workspaceId: string | null;
  name: string;
  mimeType: string;
  sizeBytes: number;
  description: string | null;
  status: string;
  chunkCount: number;
  redactionCount: number;
  scrubEvents: unknown;
  processingError: string | null;
  storageKey: string | null;
  extractMeta: unknown;
  processedAt: Date | null;
  content: string;
  createdAt: Date;
  fragmentIds: string[];
  chunks: HostedDocumentChunk[];
};

export type DocumentPatch = {
  mimeType?: string;
  description?: string | null;
  status?: string;
  processingError?: string | null;
  chunkCount?: number;
  redactionCount?: number;
  scrubEvents?: unknown;
  storageKey?: string | null;
  extractMeta?: unknown;
  processedAt?: Date | null;
  content?: string;
  fragmentIds?: string[];
  chunks?: HostedDocumentChunk[];
};

function fromHosted(d: HostedDocument): PersistedDocument {
  return {
    ...d,
    processedAt: d.processedAt ? new Date(d.processedAt) : null,
    createdAt: new Date(d.createdAt),
    fragmentIds: d.fragmentIds ?? [],
    chunks: d.chunks ?? [],
  };
}

function newId(): string {
  return crypto.randomUUID();
}

/**
 * Mark a document failed if it is still "processing" and its run was interrupted. The
 * update is scoped to the owner and only applies while the status is still "processing",
 * so a run that finishes in the meantime is never overwritten.
 */
async function failIfStillProcessing(userId: string, id: string): Promise<void> {
  const patch = { status: "failed", processingError: INTERRUPTED_CODE, processedAt: new Date() };
  if (usesHostedAppStore()) {
    const existing = await hostedAppStore().getDocument(userId, id);
    if (!existing || existing.status !== "processing") return;
    await hostedAppStore().putDocument({
      ...existing,
      status: patch.status,
      processingError: patch.processingError,
      processedAt: patch.processedAt.toISOString(),
      updatedAt: new Date().toISOString(),
    });
    return;
  }
  await db.document.updateMany({
    where: { id, userId, status: "processing" },
    data: patch,
  });
}

/** Settle interrupted documents among `docs` (all owned by `userId`) and return fresh copies. */
async function settleStaleProcessing(
  userId: string,
  docs: PersistedDocument[],
  now: number = Date.now(),
): Promise<PersistedDocument[]> {
  const stale = docs.filter(d => d.userId === userId && isStaleProcessing(d, now));
  if (stale.length === 0) return docs;
  const settled = new Map<string, PersistedDocument>();
  for (const doc of stale) {
    try {
      await failIfStillProcessing(userId, doc.id);
      const fresh = await readDocument(userId, doc.id);
      if (fresh) settled.set(doc.id, fresh);
    } catch (err) {
      console.warn("[documents] could not settle stale document (non-critical):", String(err));
    }
  }
  return docs.map(d => settled.get(d.id) ?? d);
}

async function readDocuments(
  userId: string,
  workspaceId: string | null,
): Promise<PersistedDocument[]> {
  if (usesHostedAppStore()) {
    const rows = await hostedAppStore().listDocuments(userId, workspaceId);
    return rows.map(fromHosted);
  }
  const docs = await db.document.findMany({
    where: {
      userId,
      ...(workspaceId ? { OR: [{ workspaceId }, { workspaceId: null }] } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
  return docs.map(d => ({
    id: d.id,
    userId: d.userId,
    workspaceId: d.workspaceId,
    name: d.name,
    mimeType: d.mimeType,
    sizeBytes: d.sizeBytes,
    description: d.description,
    status: d.status,
    chunkCount: d.chunkCount,
    redactionCount: d.redactionCount,
    scrubEvents: d.scrubEvents,
    processingError: d.processingError,
    storageKey: d.storageKey,
    extractMeta: d.extractMeta,
    processedAt: d.processedAt,
    content: d.content,
    createdAt: d.createdAt,
    fragmentIds: [],
    chunks: [],
  }));
}

async function readDocument(
  userId: string,
  id: string,
): Promise<PersistedDocument | null> {
  if (usesHostedAppStore()) {
    const row = await hostedAppStore().getDocument(userId, id);
    return row ? fromHosted(row) : null;
  }
  const d = await db.document.findFirst({ where: { id, userId } });
  if (!d) return null;
  return {
    id: d.id,
    userId: d.userId,
    workspaceId: d.workspaceId,
    name: d.name,
    mimeType: d.mimeType,
    sizeBytes: d.sizeBytes,
    description: d.description,
    status: d.status,
    chunkCount: d.chunkCount,
    redactionCount: d.redactionCount,
    scrubEvents: d.scrubEvents,
    processingError: d.processingError,
    storageKey: d.storageKey,
    extractMeta: d.extractMeta,
    processedAt: d.processedAt,
    content: d.content,
    createdAt: d.createdAt,
    fragmentIds: [],
    chunks: [],
  };
}

/** Read without settling interrupted runs. For ingest itself, which is the run in question. */
export const getPersistedDocumentRaw = readDocument;

export async function listPersistedDocuments(
  userId: string,
  workspaceId: string | null,
): Promise<PersistedDocument[]> {
  return settleStaleProcessing(userId, await readDocuments(userId, workspaceId));
}

export async function getPersistedDocument(
  userId: string,
  id: string,
): Promise<PersistedDocument | null> {
  const doc = await readDocument(userId, id);
  if (!doc) return null;
  const [settled] = await settleStaleProcessing(userId, [doc]);
  return settled;
}

export async function findReusableDocument(
  userId: string,
  name: string,
  sizeBytes: number,
  workspaceId: string | null,
): Promise<PersistedDocument | null> {
  if (usesHostedAppStore()) {
    const row = await hostedAppStore().findDuplicateDocument(userId, name, sizeBytes, workspaceId);
    return row ? fromHosted(row) : null;
  }
  const d = await db.document.findFirst({
    where: {
      userId,
      name,
      sizeBytes,
      ...(workspaceId ? { workspaceId } : { workspaceId: null }),
    },
    orderBy: { createdAt: "desc" },
  });
  if (!d || d.status === "failed") return null;
  return getPersistedDocument(userId, d.id);
}

export async function createProcessingDocument(input: {
  userId: string;
  workspaceId: string | null;
  name: string;
  mimeType: string;
  sizeBytes: number;
  description: string | null;
}): Promise<PersistedDocument> {
  if (usesHostedAppStore()) {
    const ts = new Date().toISOString();
    const row: HostedDocument = {
      id: newId(),
      userId: input.userId,
      workspaceId: input.workspaceId,
      name: input.name,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      description: input.description,
      status: "processing",
      chunkCount: 0,
      redactionCount: 0,
      scrubEvents: null,
      processingError: null,
      storageKey: null,
      extractMeta: null,
      processedAt: null,
      content: "",
      createdAt: ts,
      updatedAt: ts,
      fragmentIds: [],
      chunks: [],
    };
    return fromHosted(await hostedAppStore().putDocument(row));
  }
  const d = await db.document.create({
    data: {
      userId: input.userId,
      workspaceId: input.workspaceId,
      name: input.name,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      content: "",
      description: input.description,
      status: "processing",
      chunkCount: 0,
    },
  });
  return (await readDocument(input.userId, d.id))!;
}

export async function updatePersistedDocument(
  userId: string,
  id: string,
  patch: DocumentPatch,
): Promise<PersistedDocument | null> {
  if (usesHostedAppStore()) {
    const existing = await hostedAppStore().getDocument(userId, id);
    if (!existing) return null;
    const next: HostedDocument = {
      ...existing,
      ...patch,
      processedAt:
        patch.processedAt === undefined
          ? existing.processedAt
          : patch.processedAt
            ? patch.processedAt.toISOString()
            : null,
      updatedAt: new Date().toISOString(),
    };
    return fromHosted(await hostedAppStore().putDocument(next));
  }
  const owned = await db.document.findFirst({ where: { id, userId }, select: { id: true } });
  if (!owned) return null;
  const data: Record<string, unknown> = { ...patch };
  delete data.fragmentIds;
  delete data.chunks;
  await db.document.update({ where: { id }, data: data as never });
  return readDocument(userId, id);
}

export async function deletePersistedDocument(
  userId: string,
  id: string,
): Promise<PersistedDocument | null> {
  const existing = await getPersistedDocument(userId, id);
  if (!existing) return null;
  if (usesHostedAppStore()) {
    await hostedAppStore().deleteDocument(userId, id);
    return existing;
  }
  await db.document.delete({ where: { id } });
  return existing;
}
