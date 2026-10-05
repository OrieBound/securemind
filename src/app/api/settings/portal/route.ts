/**
 * GET   /api/settings/portal — signed-in users (sidebar chrome)
 * PATCH /api/settings/portal — Admin only. Name, phrase, or restore defaults.
 */

export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getIdentity, identityErrorResponse } from "@/lib/identity";
import { readPortalChrome, resetPortalBranding, savePortalText } from "@/lib/portal-branding";
import { normalizePortalName, normalizePortalTagline } from "@/lib/portal-branding-shared";
import { isAdminRole, requireAdmin } from "@/lib/roles";

const noStore = { "Cache-Control": "private, no-store" };

export async function GET(req: NextRequest) {
  try {
    const identity = await getIdentity(req);
    const chrome = await readPortalChrome();
    return Response.json(
      { ...chrome, canEdit: isAdminRole(identity.role) },
      { headers: noStore },
    );
  } catch (err) {
    const res = identityErrorResponse(err);
    if (res) return res;
    throw err;
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const identity = await getIdentity(req);
    requireAdmin(identity);

    let body: Record<string, unknown>;
    try {
      const parsed = await req.json();
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return Response.json({ error: "Invalid JSON" }, { status: 400, headers: noStore });
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400, headers: noStore });
    }

    const chrome = body.reset === true
      ? await resetPortalBranding(identity.userId)
      : await saveCheckedText(identity.userId, body);
    if (chrome instanceof Response) return chrome;
    return Response.json(chrome, { headers: noStore });
  } catch (err) {
    const res = identityErrorResponse(err);
    if (res) return res;
    console.error("[portal] save failed", err instanceof Error ? err.message : err);
    return Response.json(
      { error: "Could not save the portal. Try again." },
      { status: 500, headers: noStore },
    );
  }
}

async function saveCheckedText(userId: string, body: Record<string, unknown>): Promise<Response | Awaited<ReturnType<typeof savePortalText>>> {
  const name = normalizePortalName(body.name);
  if (!name.ok) {
    return Response.json({ error: name.error }, { status: 422, headers: noStore });
  }
  const tagline = normalizePortalTagline(body.tagline);
  if (!tagline.ok) {
    return Response.json({ error: tagline.error }, { status: 422, headers: noStore });
  }
  return savePortalText(userId, name.value, tagline.value);
}
