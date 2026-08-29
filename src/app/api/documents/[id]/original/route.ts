/**
 * GET /api/documents/[id]/original
 * Streams the stored original file to the owning user only.
 */

export const runtime = "nodejs";

import { db } from "@/lib/db";
import { originalExists, readOriginal } from "@/lib/document-storage";
import { getIdentity } from "@/lib/identity";
import { NextRequest, NextResponse } from "next/server";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { userId } = await getIdentity(req);

  const doc = await db.document.findFirst({
    where: { id, userId },
    select: { name: true, mimeType: true, storageKey: true },
  });
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
      "Content-Disposition": `attachment; filename="${doc.name.replace(/"/g, "")}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
