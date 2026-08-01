/**
 * /api/documents
 *
 * GET  — list all documents for the current user (with content preview)
 * POST — upload a file, extract text, create Document, start background embed
 */

export const runtime = "nodejs";

import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";
import {
  extractText,
  processDocument,
  resolveMimeType,
  scrubDocumentText,
} from "@/lib/documents";
import { MAX_FILE_BYTES, MAX_FILE_MB } from "@/lib/documents/constants";
import { getIdentity } from "@/lib/identity";

// ── GET ────────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { userId } = await getIdentity(req);
  const workspaceId = new URL(req.url).searchParams.get("workspaceId");

  try {
    const docs = await db.document.findMany({
      where: {
        userId,
        ...(workspaceId
          ? { OR: [{ workspaceId }, { workspaceId: null }] } // include legacy unassigned uploads
          : {}),
      },
      orderBy: { createdAt: "desc" },
      select: {
        id:          true,
        workspaceId: true,
        name:        true,
        mimeType:    true,
        sizeBytes:   true,
        description: true,
        status:      true,
        chunkCount:  true,
        redactionCount: true,
        scrubEvents: true,
        content:     true, // trimmed to preview below
        createdAt:   true,
      },
    });

    // Return a preview slice — never send full content to the list endpoint
    return NextResponse.json(
      docs.map(({ content, ...rest }) => ({
        ...rest,
        contentPreview: content.slice(0, 500),
      })),
    );
  } catch (err) {
    console.error("[documents] GET failed:", err);
    return NextResponse.json(
      { error: "Failed to load documents. Restart the dev server after schema changes." },
      { status: 500 },
    );
  }
}

// ── POST ───────────────────────────────────────────────────────────────────────

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
  const mimeType    = resolveMimeType(file.type, file.name);

  // Extract text from the uploaded buffer
  let content: string;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    content = await extractText(buffer, mimeType, file.name);
  } catch (err) {
    return NextResponse.json(
      { error: `Text extraction failed: ${String(err)}` },
      { status: 422 },
    );
  }

  if (!content.trim()) {
    return NextResponse.json(
      { error: "No extractable text found in file" },
      { status: 422 },
    );
  }

  const scrubbed = scrubDocumentText(content);
  if (!scrubbed.content) {
    return NextResponse.json(
      { error: "No usable text remained after PII scrubbing" },
      { status: 422 },
    );
  }

  // Create the Document record immediately (status = "processing")
  const doc = await db.document.create({
    data: {
      userId,
      workspaceId,
      name:        file.name,
      mimeType,
      sizeBytes:   file.size,
      content:     scrubbed.content,
      description,
      status:      "processing",
      chunkCount:  0,
      redactionCount: scrubbed.redactionCount,
      scrubEvents:    scrubbed.hadRedactions ? scrubbed.scrubEvents : undefined,
    },
    select: {
      id:          true,
      workspaceId: true,
      name:        true,
      mimeType:    true,
      sizeBytes:   true,
      description: true,
      status:      true,
      chunkCount:  true,
      redactionCount: true,
      scrubEvents: true,
      content:     true,
      createdAt:   true,
    },
  });

  // Fire-and-forget: embed chunks asynchronously so the upload responds instantly
  processDocument(doc.id).catch(err =>
    console.error("[documents] background processDocument failed:", err),
  );

  const { content: docContent, ...rest } = doc;
  return NextResponse.json(
    {
      ...rest,
      contentPreview: docContent.slice(0, 500),
      hadRedactions: scrubbed.hadRedactions,
    },
    { status: 201 },
  );
}
