/**
 * GET / PUT / DELETE /api/me/avatar
 * Owner only — userId from getIdentity, never from the body.
 */

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getIdentity, identityErrorResponse } from "@/lib/identity";
import { inspectAvatarBytes } from "@/lib/avatar-image";
import { readAvatar, removeAvatar, writeAvatar } from "@/lib/avatar-storage";

export async function GET(req: NextRequest) {
  try {
    const { userId } = await getIdentity(req);
    const stored = readAvatar(userId);
    if (!stored) {
      return NextResponse.json({ error: "No custom avatar" }, { status: 404 });
    }
    return new NextResponse(new Uint8Array(stored.bytes), {
      status: 200,
      headers: {
        "Content-Type": stored.meta.contentType,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err) {
    const res = identityErrorResponse(err);
    if (res) return res;
    throw err;
  }
}

export async function PUT(req: NextRequest) {
  try {
    const { userId } = await getIdentity(req);
    const buf = await readUploadBytes(req);
    if (!buf) {
      return NextResponse.json({ error: "Choose a JPEG or PNG image." }, { status: 422 });
    }
    const inspected = inspectAvatarBytes(buf);
    if (!inspected.ok) {
      return NextResponse.json({ error: inspected.reason }, { status: 422 });
    }
    const meta = writeAvatar(userId, buf, inspected.contentType);
    return NextResponse.json({
      ok: true,
      avatarUrl: `/api/me/avatar?v=${encodeURIComponent(meta.updatedAt)}`,
    });
  } catch (err) {
    const res = identityErrorResponse(err);
    if (res) return res;
    throw err;
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { userId } = await getIdentity(req);
    removeAvatar(userId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const res = identityErrorResponse(err);
    if (res) return res;
    throw err;
  }
}

async function readUploadBytes(req: NextRequest): Promise<Buffer | null> {
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof Blob) || file.size === 0) return null;
    return Buffer.from(await file.arrayBuffer());
  }
  const raw = Buffer.from(await req.arrayBuffer());
  return raw.length > 0 ? raw : null;
}
