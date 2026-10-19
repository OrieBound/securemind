/**
 * GET /api/documents/[id]/original
 * Streams the stored original file to the owning user only.
 */

export const runtime = "nodejs";

import { originalExists, readOriginal } from "@/lib/document-storage";
import { getPersistedDocument } from "@/lib/documents/persist";
import { getIdentity } from "@/lib/identity";
import { usesHostedAppStore } from "@/lib/workspaces/store";
import { NextRequest, NextResponse } from "next/server";

/** ASCII fallback plus RFC 5987 UTF-8 name; strips quotes, backslashes and control characters. */
function contentDisposition(name: string): string {
  const clean = name.replace(/[\u0000-\u001f\u007f"\\]/g, "").slice(0, 200) || "download";
  const ascii = clean.replace(/[^\x20-\x7e]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(clean)}`;
}

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { userId } = await getIdentity(req);

  if (usesHostedAppStore()) {
    return NextResponse.json(
      { error: "Original files are not stored on the hosted install." },
      { status: 404 },
    );
  }

  const doc = await getPersistedDocument(userId, id);
  if (!doc) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }
  if (!originalExists(doc.storageKey)) {
    return NextResponse.json({ error: "Original file is not stored" }, { status: 404 });
  }

  const buffer = await readOriginal(doc.storageKey!);
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": doc.mimeType || "application/octet-stream",
      "Content-Disposition": contentDisposition(doc.name),
      "Cache-Control": "private, no-store",
    },
  });
}
