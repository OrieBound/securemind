/**
 * /api/documents/[id]
 *
 * GET    — return full document data + all embedded chunks
 * DELETE — remove document and cascade-delete its MemoryFragment records
 */

export const runtime = "nodejs";

import { db } from "@/lib/db";
import { getIdentity } from "@/lib/identity";
import { NextRequest, NextResponse } from "next/server";

type Params = { params: Promise<{ id: string }> };

// ── GET ────────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { userId } = await getIdentity(req);

  const doc = await db.document.findFirst({
    where: { id, userId },
    include: {
      fragments: {
        where:   { category: "document" },
        select:  { id: true, content: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!doc) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  return NextResponse.json(doc);
}

// ── DELETE ─────────────────────────────────────────────────────────────────────

export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { userId } = await getIdentity(req);

  // Verify ownership before deleting
  const doc = await db.document.findFirst({ where: { id, userId }, select: { id: true } });
  if (!doc) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  // MemoryFragment records cascade-delete via schema relation (onDelete: Cascade)
  await db.document.delete({ where: { id } });

  return new Response(null, { status: 204 });
}
