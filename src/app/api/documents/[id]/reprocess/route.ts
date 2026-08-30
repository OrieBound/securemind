/**
 * POST /api/documents/[id]/reprocess
 * Re-extract from the stored original (or re-chunk stored text) and re-embed.
 */

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { extractDocument, processDocument, scrubDocumentText } from "@/lib/documents";
import { getPersistedDocument, updatePersistedDocument } from "@/lib/documents/persist";
import { originalExists, readOriginal } from "@/lib/document-storage";
import { getIdentity } from "@/lib/identity";
import { ImageExtractError } from "@/lib/image-extract";
import { inspectImagePrivacy } from "@/lib/image-privacy";
import { shouldSyncDocumentIngest } from "@/lib/runtime-env";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { userId } = await getIdentity(req);

  const doc = await getPersistedDocument(userId, id);
  if (!doc) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  await updatePersistedDocument(userId, doc.id, { status: "processing", processingError: null });

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
      await updatePersistedDocument(userId, doc.id, {
          content: scrubbed.content || drafts.map(d => d.content).join("\n\n"),
          extractMeta: extracted.extractMeta,
          redactionCount: scrubbed.redactionCount,
          scrubEvents: scrubbed.hadRedactions ? scrubbed.scrubEvents : undefined,
        });
      if (shouldSyncDocumentIngest()) {
        await processDocument(doc.id, drafts, userId);
      } else {
        processDocument(doc.id, drafts, userId).catch(err =>
          console.error("[documents] reprocess failed:", err),
        );
      }
    } else {
      if (shouldSyncDocumentIngest()) {
        await processDocument(doc.id, undefined, userId);
      } else {
        processDocument(doc.id, undefined, userId).catch(err =>
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
    await updatePersistedDocument(userId, doc.id, {
        status: "failed",
        processingError: code,
        processedAt: new Date(),
        extractMeta: imageScan ? { kind: "image", imageScan } : undefined,
      });
    return NextResponse.json({ error: message, code }, { status: 422 });
  }

  const updated = await getPersistedDocument(userId, doc.id);
  return NextResponse.json(updated);
}
