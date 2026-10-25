/**
 * /api/documents
 *
 * GET  — list documents for the current user (preview only)
 * POST — persist original, extract + scrub, create Document, embed
 */

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import {
  extractDocument,
  isAcceptedDocumentType,
  processDocument,
  resolveMimeType,
  scrubDocumentText,
  type DocumentChunkDraft,
} from "@/lib/documents";
import {
  createProcessingDocument,
  findReusableDocument,
  listPersistedDocuments,
  updatePersistedDocument,
} from "@/lib/documents/persist";
import {
  MAX_ATTACHMENT_PROMPT_CHARS,
  MAX_FILE_BYTES,
  MAX_FILE_MB,
} from "@/lib/documents/constants";
import { writeOriginal, writeSpreadsheetTables } from "@/lib/document-storage";
import { getIdentity, identityErrorResponse } from "@/lib/identity";
import { recordSecurityEvents } from "@/lib/analytics/write";
import type { SecuritySource } from "@/lib/analytics/types";
import { shouldSyncDocumentIngest } from "@/lib/runtime-env";
import { usesHostedAppStore } from "@/lib/workspaces/store";
import { ImageExtractError } from "@/lib/image-extract";
import { inspectImagePrivacy } from "@/lib/image-privacy";
import { assertUploadQuota, UploadRejected, uploadLimits, withTimeout } from "@/lib/documents/upload-guard";

function listPublicDoc(doc: { content?: string; storageKey?: string | null } & Record<string, unknown>) {
  const { content, storageKey, fragmentIds, chunks, userId, ...rest } = doc;
  return {
    ...rest,
    hasOriginal: Boolean(storageKey),
    contentPreview: typeof content === "string" ? content.slice(0, 500) : "",
  };
}

/** Upload / reuse responses may include a truncated body for same-turn chat. */
function publicDoc(doc: { content: string; storageKey?: string | null } & Record<string, unknown>) {
  return {
    ...listPublicDoc(doc),
    content: doc.content.slice(0, MAX_ATTACHMENT_PROMPT_CHARS),
  };
}

export async function GET(req: NextRequest) {
  try {
    const { userId } = await getIdentity(req);
    const workspaceId = new URL(req.url).searchParams.get("workspaceId");
    const docs = await listPersistedDocuments(userId, workspaceId);
    return NextResponse.json(docs.map(listPublicDoc));
  } catch (err) {
    const auth = identityErrorResponse(err);
    if (auth) return auth;
    console.error("[documents] GET failed:", err);
    return NextResponse.json(
      { error: "Failed to load documents." },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const { userId } = await getIdentity(req);

  // Refuse an oversized upload before the whole body is read into memory. The multipart wrapper
  // adds a little, so allow 1 MB of slack; the exact file-size check below still applies.
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_FILE_BYTES + 1024 * 1024) {
    return NextResponse.json({ error: `File exceeds the ${MAX_FILE_MB} MB limit` }, { status: 413 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid multipart form data" }, { status: 400 });
  }

  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: `File exceeds the ${MAX_FILE_MB} MB limit` }, { status: 413 });
  }

  const description = (formData.get("description") as string | null) || null;
  const workspaceId = (formData.get("workspaceId") as string | null) || null;
  const mimeType = resolveMimeType(file.type, file.name);

  if (!isAcceptedDocumentType(mimeType, file.name)) {
    return NextResponse.json(
      { error: "That file type is not supported. Use PDF, DOCX, XLSX, CSV, text, code, or an image." },
      { status: 415 },
    );
  }

  try {
    await assertUploadQuota(userId, file.size);
  } catch (err) {
    if (err instanceof UploadRejected) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    }
    throw err;
  }

  const existing = await findReusableDocument(userId, file.name, file.size, workspaceId);

  if (existing) {
    return NextResponse.json(
      { ...publicDoc(existing), hadRedactions: (existing.redactionCount ?? 0) > 0, reused: true },
      { status: 200 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  const doc = await createProcessingDocument({
    userId,
    workspaceId,
    name: file.name,
    mimeType,
    sizeBytes: file.size,
    description,
  });

  let storageKey = doc.storageKey;
  if (!usesHostedAppStore()) {
    try {
      storageKey = await writeOriginal({
        userId,
        documentId: doc.id,
        filename: file.name,
        buffer,
      });
      await updatePersistedDocument(userId, doc.id, { storageKey });
    } catch (err) {
      console.warn("[documents] original persist failed:", err);
    }
  }

  let extractedText = "";
  const drafts: DocumentChunkDraft[] = [];
  let extractMeta: Record<string, unknown> | undefined;
  let errorCode: string | null = null;
  let errorMessage: string | null = null;

  try {
    const extracted = await withTimeout(
      extractDocument(buffer, mimeType, file.name),
      uploadLimits().extractTimeoutMs,
      "Text extraction took too long and was stopped.",
    );
    extractedText = extracted.text;
    extractMeta = extracted.extractMeta;
    if (extracted.tables && storageKey) {
      const scrubbedTables = [];
      for (const table of extracted.tables) {
        const headers = [];
        for (const h of table.headers) {
          headers.push((await scrubDocumentText(h)).content || h);
        }
        const rows = [];
        for (const row of table.rows) {
          const next = [];
          for (const cell of row) {
            next.push((await scrubDocumentText(cell)).content);
          }
          rows.push(next);
        }
        scrubbedTables.push({ ...table, headers, rows });
      }
      writeSpreadsheetTables(storageKey, scrubbedTables);
    }
    if (extracted.chunks?.length) {
      for (const chunk of extracted.chunks) {
        const scrubbedChunk = await scrubDocumentText(chunk.content);
        if (scrubbedChunk.content) {
          drafts.push({ content: scrubbedChunk.content, provenance: chunk.provenance });
        }
      }
    }
  } catch (err) {
    if (err instanceof ImageExtractError) {
      errorCode = err.code;
      errorMessage = err.message;
      extractMeta = {
        kind: "image",
        imageScan: inspectImagePrivacy({
          buffer,
          mimeType,
          filename: file.name,
          textExtracted: false,
        }),
      };
    } else if (err instanceof UploadRejected) {
      errorCode = err.code;
      errorMessage = err.message;
    } else {
      // The parser's own message can quote file contents, so store a plain one and log the name.
      errorCode = "EXTRACT_FAILED";
      errorMessage = "Text could not be extracted from this file.";
      console.warn("[documents] extraction failed:", err instanceof Error ? err.name : "error");
    }
  }

  if (!errorCode && !extractedText.trim() && drafts.length === 0) {
    errorCode = "EMPTY_EXTRACT";
    errorMessage = "No extractable text found in file";
  }

  if (errorCode) {
    const failed = await updatePersistedDocument(userId, doc.id, {
      status: "failed",
      content: "",
      chunkCount: 0,
      processingError: errorCode,
      processedAt: new Date(),
      storageKey,
      extractMeta,
    });
    return NextResponse.json(
      { ...publicDoc(failed!), error: errorMessage, reused: false },
      { status: 201 },
    );
  }

  const scrubbed = await scrubDocumentText(extractedText);
  if (!scrubbed.content && drafts.length === 0) {
    const failed = await updatePersistedDocument(userId, doc.id, {
      status: "failed",
      content: "",
      processingError: "EMPTY_EXTRACT",
      processedAt: new Date(),
      storageKey,
    });
    return NextResponse.json(
      { ...publicDoc(failed!), error: "No usable text remained after the sensitive-data scan" },
      { status: 201 },
    );
  }

  const updated = await updatePersistedDocument(userId, doc.id, {
    content: scrubbed.content || drafts.map(d => d.content).join("\n\n"),
    redactionCount: scrubbed.redactionCount,
    scrubEvents: scrubbed.hadRedactions ? scrubbed.scrubEvents : undefined,
    extractMeta,
    storageKey,
    processingError: null,
    status: "processing",
  });

  if (shouldSyncDocumentIngest()) {
    await processDocument(updated!.id, drafts, userId);
  } else {
    processDocument(updated!.id, drafts, userId).catch(err =>
      console.error("[documents] background processDocument failed:", err),
    );
  }

  if (scrubbed.hadRedactions && scrubbed.scrubEvents.length > 0) {
    const source: SecuritySource = mimeType.startsWith("image/")
      ? "image_ocr"
      : "knowledge_document";
    recordSecurityEvents(
      scrubbed.scrubEvents.map(ev => ({
        userId,
        workspaceId,
        source,
        category: ev.category,
        outcome: "redacted" as const,
        count: ev.count,
        resourceKind: "document" as const,
        resourceId: updated!.id,
      })),
    ).catch(err =>
      console.warn("[documents] security telemetry failed (non-critical):", String(err)),
    );
  }

  return NextResponse.json(
    { ...publicDoc(updated!), hadRedactions: scrubbed.hadRedactions, reused: false },
    { status: 201 },
  );
}
