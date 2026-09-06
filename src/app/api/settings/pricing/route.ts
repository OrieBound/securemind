export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getIdentity, identityErrorResponse } from "@/lib/identity";
import { isAdminRole, requireAdmin } from "@/lib/roles";
import {
  COST_ESTIMATE_DISCLAIMER,
  PRICING_BUNDLE_EFFECTIVE,
  PRICING_BUNDLE_VERSION,
} from "@/lib/pricing";
import {
  listEditableRates,
  overridesFromEditedRows,
  parseTokenRate,
  type EditableRateRow,
  type RateProvider,
} from "@/lib/pricing/rate-overrides";
import {
  getPricingRateOverrides,
  savePricingRateOverrides,
} from "@/lib/pricing/rate-overrides-store";

function isRateProvider(value: unknown): value is RateProvider {
  return value === "groq" || value === "bedrock";
}

function parseEditedRows(raw: unknown): { rows?: EditableRateRow[]; error?: string } {
  if (!Array.isArray(raw)) return { error: "rates must be an array." };
  const rows: EditableRateRow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return { error: "Each rate row must be an object." };
    }
    const rec = item as Record<string, unknown>;
    if (!isRateProvider(rec.provider)) {
      return { error: "Provider must be groq or bedrock." };
    }
    const model = typeof rec.model === "string" ? rec.model.trim() : "";
    if (!model || model.length > 200) {
      return { error: "Model id is required." };
    }
    const rates = parseTokenRate({
      inputPerM: rec.inputPerM,
      outputPerM: rec.outputPerM,
    });
    if (!rates) {
      return { error: `Invalid USD-per-million rates for ${model}.` };
    }
    rows.push({
      provider: rec.provider,
      model,
      inputPerM: rates.inputPerM,
      outputPerM: rates.outputPerM,
      source: "override",
    });
  }
  return { rows };
}

async function payload(canEdit: boolean) {
  const overrides = await getPricingRateOverrides();
  return {
    disclaimer: COST_ESTIMATE_DISCLAIMER,
    pricing: {
      version: PRICING_BUNDLE_VERSION,
      effective: PRICING_BUNDLE_EFFECTIVE,
    },
    rates: listEditableRates(overrides),
    overrideCount: Object.keys(overrides).length,
    canEdit,
  };
}

export async function GET(req: NextRequest) {
  try {
    const identity = await getIdentity(req);
    return Response.json(await payload(isAdminRole(identity.role)), {
      headers: { "Cache-Control": "no-store" },
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

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 });
    }

    if (body.reset === true) {
      await savePricingRateOverrides({}, identity.userId);
      return Response.json(await payload(true));
    }

    const parsed = parseEditedRows(body.rates);
    if (parsed.error || !parsed.rows) {
      return Response.json({ error: parsed.error ?? "Invalid rates." }, { status: 422 });
    }

    const map = overridesFromEditedRows(parsed.rows);
    await savePricingRateOverrides(map, identity.userId);
    return Response.json(await payload(true));
  } catch (err) {
    const res = identityErrorResponse(err);
    if (res) return res;
    throw err;
  }
}
