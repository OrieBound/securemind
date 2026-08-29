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
import { NextRequest, NextResponse } from "next/server";

type Params = { params: Promise<{ id: string }> };

const DEFAULT_CHUNKS_LIMIT = 8;
const MAX_CHUNKS_LIMIT = 20;

const docFields = {
  id: true,
  workspaceId: true,
  name: true,
  mimeType: true,
  sizeBytes: true,
  description: true,
  status: true,
  chunkCount: true,
  redactionCount: true,
  scrubEvents: true,
  processingError: true,
  storageKey: true,
  extractMeta: true,
  processedAt: true,
  content: true,
  createdAt: true,
} as const;

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { userId } = await getIdentity(req);
  const url = new URL(req.url);
  const metaOnly = url.searchParams.get("meta") === "1";

  if (metaOnly) {
    const doc = await db.document.findFirst({
      where: { id, userId },
      select: {
        id: true,
        status: true,
        chunkCount: true,
        processingError: true,
        processedAt: true,
      },
    });
    if (!doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }
    return NextResponse.json(doc);
  }

  const rawPage = Number.parseInt(url.searchParams.get("chunksPage") ?? "0", 10);
  const rawLimit = Number.parseInt(url.searchParams.get("chunksLimit") ?? String(DEFAULT_CHUNKS_LIMIT), 10);
  const chunksPage = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 0;
  const chunksLimit = Number.isFinite(rawLimit)
    ? Math.min(MAX_CHUNKS_LIMIT, Math.max(1, rawLimit))
    : DEFAULT_CHUNKS_LIMIT;

  const doc = await db.document.findFirst({
    where: { id, userId },
    select: docFields,
  });

  if (!doc) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  const fragmentWhere = { documentId: id, userId, category: "document" };
  const [fragmentTotal, fragments] = await Promise.all([
    db.memoryFragment.count({ where: fragmentWhere }),
    db.memoryFragment.findMany({
      where: fragmentWhere,
      select: { id: true, content: true, createdAt: true, provenance: true },
      orderBy: { createdAt: "asc" },
      skip: chunksPage * chunksLimit,
      take: chunksLimit,
    }),
  ]);

  const { storageKey, ...rest } = doc;
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

  const doc = await db.document.findFirst({
    where: { id, userId },
    select: { id: true, storageKey: true, workspaceId: true },
  });
  if (!doc) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  const fragments = await db.memoryFragment.findMany({
    where: { documentId: id, userId },
    select: { id: true },
  });
  await purgeDocumentChunksFromDynamo({
    userId,
    workspaceId: doc.workspaceId,
    fragmentIds: fragments.map((f) => f.id),
  });

  removeOriginal(doc.storageKey);
  await db.document.delete({ where: { id } });

  return new Response(null, { status: 204 });
}
