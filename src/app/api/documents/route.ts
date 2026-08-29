/**
 * /api/documents
 *
 * GET  — list documents for the current user (preview only)
 * POST — persist original, extract + scrub, create Document, embed
 */

export const runtime = "nodejs";

import { db } from "@/lib/db";
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
  MAX_ATTACHMENT_PROMPT_CHARS,
  MAX_FILE_BYTES,
  MAX_FILE_MB,
} from "@/lib/documents/constants";
import { writeOriginal, writeSpreadsheetTables } from "@/lib/document-storage";
import { getIdentity } from "@/lib/identity";
import { recordSecurityEvents } from "@/lib/analytics/write";
import type { SecuritySource } from "@/lib/analytics/types";
import { shouldSyncDocumentIngest } from "@/lib/runtime-env";
import { ImageExtractError } from "@/lib/image-extract";
import { inspectImagePrivacy } from "@/lib/image-privacy";

const docSelect = {
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

/** List payloads must not pull `content` — that column can be megabytes per row. */
const listSelect = {
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
  createdAt: true,
} as const;

function listPublicDoc(doc: { content?: string; storageKey?: string | null } & Record<string, unknown>) {
  const { content, storageKey, ...rest } = doc;
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
  const { userId } = await getIdentity(req);
  const workspaceId = new URL(req.url).searchParams.get("workspaceId");

  try {
    const docs = await db.document.findMany({
      where: {
        userId,
        ...(workspaceId
          ? { OR: [{ workspaceId }, { workspaceId: null }] }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      select: listSelect,
    });

    return NextResponse.json(docs.map(listPublicDoc));
  } catch (err) {
    console.error("[documents] GET failed:", err);
    return NextResponse.json(
      { error: "Failed to load documents. Restart the dev server after schema changes." },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const { userId } = await getIdentity(req);

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

  const existing = await db.document.findFirst({
    where: {
      userId,
      name: file.name,
      sizeBytes: file.size,
      ...(workspaceId ? { workspaceId } : { workspaceId: null }),
    },
    select: docSelect,
    orderBy: { createdAt: "desc" },
  });

  if (existing && existing.status !== "failed") {
    return NextResponse.json(
      { ...publicDoc(existing), hadRedactions: (existing.redactionCount ?? 0) > 0, reused: true },
      { status: 200 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  const doc = existing
    ? await db.document.update({
        where: { id: existing.id },
        data: {
          mimeType,
          description,
          status: "processing",
          processingError: null,
          chunkCount: 0,
        },
        select: docSelect,
      })
    : await db.document.create({
        data: {
          userId,
          workspaceId,
          name: file.name,
          mimeType,
          sizeBytes: file.size,
          content: "",
          description,
          status: "processing",
          chunkCount: 0,
        },
        select: docSelect,
      });

  let storageKey = doc.storageKey;
  try {
    storageKey = await writeOriginal({
      userId,
      documentId: doc.id,
      filename: file.name,
      buffer,
    });
    await db.document.update({
      where: { id: doc.id },
      data: { storageKey },
    });
  } catch (err) {
    console.warn("[documents] original persist failed:", err);
  }

  let extractedText = "";
  let drafts: DocumentChunkDraft[] = [];
  let extractMeta: Record<string, unknown> | undefined;
  let errorCode: string | null = null;
  let errorMessage: string | null = null;

  try {
    const extracted = await extractDocument(buffer, mimeType, file.name);
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
    } else {
      errorCode = "EXTRACT_FAILED";
      errorMessage = err instanceof Error ? err.message : "Text extraction failed";
    }
  }

  if (!errorCode && !extractedText.trim() && drafts.length === 0) {
    errorCode = "EMPTY_EXTRACT";
    errorMessage = "No extractable text found in file";
  }

  if (errorCode) {
    const failed = await db.document.update({
      where: { id: doc.id },
      data: {
        status: "failed",
        content: "",
        chunkCount: 0,
        processingError: errorCode,
        processedAt: new Date(),
        storageKey,
        extractMeta: extractMeta as object | undefined,
      },
      select: docSelect,
    });
    return NextResponse.json(
      { ...publicDoc(failed), error: errorMessage, reused: Boolean(existing) },
      { status: 201 },
    );
  }

  const scrubbed = await scrubDocumentText(extractedText);
  if (!scrubbed.content && drafts.length === 0) {
    const failed = await db.document.update({
      where: { id: doc.id },
      data: {
        status: "failed",
        content: "",
        processingError: "EMPTY_EXTRACT",
        processedAt: new Date(),
        storageKey,
      },
      select: docSelect,
    });
    return NextResponse.json(
      { ...publicDoc(failed), error: "No usable text remained after the sensitive-data scan" },
      { status: 201 },
    );
  }

  const updated = await db.document.update({
    where: { id: doc.id },
    data: {
      content: scrubbed.content || drafts.map(d => d.content).join("\n\n"),
      redactionCount: scrubbed.redactionCount,
      scrubEvents: scrubbed.hadRedactions ? scrubbed.scrubEvents : undefined,
      extractMeta: extractMeta as object | undefined,
      storageKey,
      processingError: null,
      status: "processing",
    },
    select: docSelect,
  });

  if (shouldSyncDocumentIngest()) {
    await processDocument(updated.id, drafts);
  } else {
    processDocument(updated.id, drafts).catch(err =>
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
        resourceId: updated.id,
      })),
    ).catch(err =>
      console.warn("[documents] security telemetry failed (non-critical):", String(err)),
    );
  }

  return NextResponse.json(
    { ...publicDoc(updated), hadRedactions: scrubbed.hadRedactions, reused: Boolean(existing) },
    { status: existing ? 200 : 201 },
  );
}
