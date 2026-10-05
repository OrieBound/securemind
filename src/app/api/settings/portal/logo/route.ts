/**
 * GET    /api/settings/portal/logo — signed-in users
 * PUT    /api/settings/portal/logo — Admin only. JPEG or PNG.
 * DELETE /api/settings/portal/logo — Admin only. Restores the SecureMind mark.
 */

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { inspectAvatarBytes } from "@/lib/avatar-image";
import { getIdentity, identityErrorResponse } from "@/lib/identity";
import { clearPortalLogo, savePortalLogo } from "@/lib/portal-branding";
import { readPortalLogo } from "@/lib/portal-logo-storage";
import { requireAdmin } from "@/lib/roles";

export async function GET(req: NextRequest) {
  try {
    await getIdentity(req);
    const stored = await readPortalLogo();
    if (!stored) {
      return NextResponse.json({ error: "No custom portal logo" }, { status: 404 });
    }
    return new NextResponse(new Uint8Array(stored.bytes), {
      status: 200,
      headers: {
        "Content-Type": stored.meta.contentType,
        "Cache-Control": "private, no-store",
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
    const identity = await getIdentity(req);
    requireAdmin(identity);
    const buf = await readUploadBytes(req);
    if (!buf) {
      return Response.json({ error: "Choose a JPEG or PNG image." }, { status: 422 });
    }
    const inspected = inspectAvatarBytes(buf);
    if (!inspected.ok) {
      return Response.json({ error: inspected.reason }, { status: 422 });
    }
    const chrome = await savePortalLogo(identity.userId, buf, inspected.contentType);
    return Response.json(chrome);
  } catch (err) {
    const status = err && typeof err === "object" && "status" in err
      ? Number((err as { status: number }).status)
      : 0;
    if (status === 503) {
      return Response.json(
        { error: err instanceof Error ? err.message : "Portal logo storage is not configured." },
        { status: 503 },
      );
    }
    const res = identityErrorResponse(err);
    if (res) return res;
    console.error("[portal] logo save failed", err instanceof Error ? err.message : err);
    return Response.json({ error: "Could not save the logo. Try again." }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const identity = await getIdentity(req);
    requireAdmin(identity);
    const chrome = await clearPortalLogo(identity.userId);
    return Response.json(chrome);
  } catch (err) {
    const res = identityErrorResponse(err);
    if (res) return res;
    console.error("[portal] logo remove failed", err instanceof Error ? err.message : err);
    return Response.json({ error: "Could not remove the logo. Try again." }, { status: 500 });
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
