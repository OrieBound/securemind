/**
 * POST /api/documents/[id]/reprocess
 * Re-extract from the stored original (or re-chunk stored text) and re-embed.
 */

export const runtime = "nodejs";

import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import { extractDocument, processDocument, scrubDocumentText } from "@/lib/documents";
import { originalExists, readOriginal } from "@/lib/document-storage";
import { getIdentity } from "@/lib/identity";
import { ImageExtractError } from "@/lib/image-extract";
import { inspectImagePrivacy } from "@/lib/image-privacy";
import { shouldSyncDocumentIngest } from "@/lib/runtime-env";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { userId } = await getIdentity(req);

  const doc = await db.document.findFirst({ where: { id, userId } });
  if (!doc) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  await db.document.update({
    where: { id: doc.id },
    data: { status: "processing", processingError: null },
  });

  try {
    if (originalExists(doc.storageKey)) {
      const buffer = await readOriginal(doc.storageKey!);
      const extracted = await extractDocument(buffer, doc.mimeType, doc.name);
      const scrubbed = await scrubDocumentText(extracted.text);
      const drafts = [];
      for (const chunk of extracted.chunks ?? []) {
        const piece = await scrubDocumentText(chunk.content);
        if (piece.content) drafts.push({ content: piece.content, provenance: chunk.provenance });
      }
      await db.document.update({
        where: { id: doc.id },
        data: {
          content: scrubbed.content || drafts.map(d => d.content).join("\n\n"),
          extractMeta: extracted.extractMeta as object | undefined,
          redactionCount: scrubbed.redactionCount,
          scrubEvents: scrubbed.hadRedactions ? scrubbed.scrubEvents : undefined,
        },
      });
      if (shouldSyncDocumentIngest()) {
        await processDocument(doc.id, drafts);
      } else {
        processDocument(doc.id, drafts).catch(err =>
          console.error("[documents] reprocess failed:", err),
        );
      }
    } else {
      if (shouldSyncDocumentIngest()) {
        await processDocument(doc.id);
      } else {
        processDocument(doc.id).catch(err =>
          console.error("[documents] reprocess failed:", err),
        );
      }
    }
  } catch (err) {
    const code = err instanceof ImageExtractError ? err.code : "EXTRACT_FAILED";
    const message = err instanceof Error ? err.message : "Reprocess failed";
    const imageScan = err instanceof ImageExtractError && originalExists(doc.storageKey)
      ? inspectImagePrivacy({
          buffer: await readOriginal(doc.storageKey!),
          mimeType: doc.mimeType,
          filename: doc.name,
          textExtracted: false,
        })
      : undefined;
    await db.document.update({
      where: { id: doc.id },
      data: {
        status: "failed",
        processingError: code,
        processedAt: new Date(),
        extractMeta: imageScan ? { kind: "image", imageScan } : undefined,
      },
    });
    return NextResponse.json({ error: message, code }, { status: 422 });
  }

  const updated = await db.document.findFirst({
    where: { id: doc.id, userId },
    select: {
      id: true,
      status: true,
      chunkCount: true,
      processingError: true,
      processedAt: true,
    },
  });
  return NextResponse.json(updated);
}
