export const runtime = "nodejs";

/**
 * One model of the one-time setup sweep.
 *
 * The browser calls this in a loop after a vendor key is saved. Each call
 * checks the next listed chat model that this key has not already been
 * checked against. Account-wide failures (no credits, provider unreachable)
 * stop the sweep without marking every model failed.
 */

import { NextRequest } from "next/server";
import { getIdentity, identityErrorResponse } from "@/lib/identity";
import { requireAdmin } from "@/lib/roles";
import { getModelCatalogCached } from "@/lib/models/catalog";
import { modelKey, withModelAvailability } from "@/lib/models/model-availability";
import { getModelAvailability, modelCredentialScope } from "@/lib/models/model-availability-store";
import { checkModelReachability } from "@/lib/models/reachability";
import { isAccountWideSetupStop, modelsAwaitingSetupCheck } from "@/lib/models/setup-check";
import { isWiredVendorKind, type WiredVendorKind } from "@/lib/vendor-providers";
import type { CatalogModel } from "@/lib/models/catalog-shared";
import type { ModelCatalog } from "@/lib/models/catalog";

function listedFor(provider: WiredVendorKind, catalog: ModelCatalog): CatalogModel[] {
  if (provider === "groq") return catalog.groq;
  if (provider === "google") return catalog.google;
  if (provider === "openai") return catalog.openai;
  if (provider === "anthropic") return catalog.anthropic;
  return catalog.xai;
}

export async function POST(req: NextRequest) {
  try {
    const identity = await getIdentity(req);
    requireAdmin(identity);

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const provider = typeof body.provider === "string" ? body.provider.trim() : "";
    if (!isWiredVendorKind(provider)) {
      return Response.json({ error: "provider is required" }, { status: 400 });
    }

    const catalog = await getModelCatalogCached({ fresh: body.fresh === true });
    const [records, scope] = await Promise.all([
      getModelAvailability(),
      modelCredentialScope(provider),
    ]);
    const pending = modelsAwaitingSetupCheck(
      listedFor(provider, catalog)
        .filter(model => model.provider === provider)
        .map(model => withModelAvailability(model, records[modelKey(model)], scope)),
    );
    if (pending.length === 0) {
      return Response.json({
        done: true,
        stopped: false,
        provider,
        modelId: null,
        ok: null,
        remaining: 0,
        code: null,
        message: null,
      });
    }

    const next = pending[0]!;
    const result = await checkModelReachability({
      modelId: next.id,
      providerHint: provider,
      signal: req.signal,
      userId: identity.userId,
      persistAccountWide: false,
      touchCatalogCache: false,
    });
    const stopped = isAccountWideSetupStop(result.code, result.message);
    return Response.json({
      done: stopped,
      stopped,
      provider,
      modelId: result.modelId,
      ok: result.ok,
      remaining: Math.max(0, pending.length - (stopped ? 0 : 1)),
      code: result.code ?? null,
      message: result.message ?? null,
    });
  } catch (err) {
    const res = identityErrorResponse(err);
    if (res) return res;
    throw err;
  }
}
