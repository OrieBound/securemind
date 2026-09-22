export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getIdentity, identityErrorResponse } from "@/lib/identity";
import { getModelCatalogCached, invalidateModelCatalogCache } from "@/lib/models/catalog";
import { requireAdmin } from "@/lib/roles";
import { patchModelAvailability } from "@/lib/models/model-availability-store";

export async function GET(req: NextRequest) {
  try {
    const identity = await getIdentity(req);
    const fresh = req.nextUrl.searchParams.get("fresh") === "1";
    const catalog = await getModelCatalogCached({ fresh });
    return Response.json({
      ...catalog,
      role: identity.role,
    });
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
    const body = await req.json().catch(() => null);
    if (!body || typeof body.modelId !== "string" || typeof body.provider !== "string" || typeof body.hidden !== "boolean") {
      return Response.json({ error: "modelId, provider, and hidden are required" }, { status: 400 });
    }
    const catalog = await getModelCatalogCached();
    const model = [catalog.groq, catalog.bedrock, catalog.ollama, catalog.openai, catalog.anthropic, catalog.google, catalog.xai]
      .flat().find(m => m.id === body.modelId && m.provider === body.provider);
    if (!model) return Response.json({ error: "Model not found" }, { status: 404 });
    await patchModelAvailability(model, { hidden: body.hidden }, identity.userId);
    invalidateModelCatalogCache();
    return Response.json({ ok: true, hidden: body.hidden });
  } catch (err) {
    const res = identityErrorResponse(err);
    if (res) return res;
    throw err;
  }
}
