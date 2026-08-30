/**
 * /api/documents/[id]
 *
 * GET    — document metadata + paginated chunks (or ?meta=1 for poll)
 * DELETE — document, fragments, and original file
 */

export const runtime = "nodejs";

import { db } from "@/lib/db";
import { removeOriginal } from "@/lib/document-storage";
import { getIdentity } from "@/lib/identity";
import { purgeDocumentChunksFromDynamo } from "@/lib/storage/dynamodb-ingest";
import { deletePersistedDocument, getPersistedDocument } from "@/lib/documents/persist";
import { usesHostedAppStore } from "@/lib/workspaces/store";
import { NextRequest, NextResponse } from "next/server";

type Params = { params: Promise<{ id: string }> };

const DEFAULT_CHUNKS_LIMIT = 8;
const MAX_CHUNKS_LIMIT = 20;

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { userId } = await getIdentity(req);
  const url = new URL(req.url);
  const metaOnly = url.searchParams.get("meta") === "1";

  const doc = await getPersistedDocument(userId, id);
  if (!doc) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  if (metaOnly) {
    return NextResponse.json({
      id: doc.id,
      status: doc.status,
      chunkCount: doc.chunkCount,
      processingError: doc.processingError,
      processedAt: doc.processedAt,
    });
  }

  const rawPage = Number.parseInt(url.searchParams.get("chunksPage") ?? "0", 10);
  const rawLimit = Number.parseInt(url.searchParams.get("chunksLimit") ?? String(DEFAULT_CHUNKS_LIMIT), 10);
  const chunksPage = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 0;
  const chunksLimit = Number.isFinite(rawLimit)
    ? Math.min(MAX_CHUNKS_LIMIT, Math.max(1, rawLimit))
    : DEFAULT_CHUNKS_LIMIT;

  let fragmentTotal = 0;
  let fragments: Array<{ id: string; content: string; createdAt: Date | string; provenance: unknown }> = [];

  if (usesHostedAppStore()) {
    const all = doc.chunks ?? [];
    fragmentTotal = all.length;
    fragments = all.slice(chunksPage * chunksLimit, chunksPage * chunksLimit + chunksLimit);
  } else {
    const fragmentWhere = { documentId: id, userId, category: "document" };
    const [total, rows] = await Promise.all([
      db.memoryFragment.count({ where: fragmentWhere }),
      db.memoryFragment.findMany({
        where: fragmentWhere,
        select: { id: true, content: true, createdAt: true, provenance: true },
        orderBy: { createdAt: "asc" },
        skip: chunksPage * chunksLimit,
        take: chunksLimit,
      }),
    ]);
    fragmentTotal = total;
    fragments = rows;
  }

  const { storageKey, fragmentIds, chunks, userId: _uid, ...rest } = doc;
  return NextResponse.json({
    ...rest,
    hasOriginal: Boolean(storageKey),
    fragmentTotal,
    fragments,
  });
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { userId } = await getIdentity(req);

  const doc = await getPersistedDocument(userId, id);
  if (!doc) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  let fragmentIds = doc.fragmentIds;
  if (!usesHostedAppStore()) {
    const fragments = await db.memoryFragment.findMany({
      where: { documentId: id, userId },
      select: { id: true },
    });
    fragmentIds = fragments.map(f => f.id);
  }
  await purgeDocumentChunksFromDynamo({
    userId,
    workspaceId: doc.workspaceId,
    fragmentIds,
  });

  if (!usesHostedAppStore()) {
    removeOriginal(doc.storageKey);
  }
  await deletePersistedDocument(userId, id);

  return new Response(null, { status: 204 });
}
