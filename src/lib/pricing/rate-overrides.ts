/**
 * Sparse Admin overrides on top of curated Groq / Bedrock list rates.
 * Past inference events keep the rates they were recorded with.
 */

import { BEDROCK_MODEL_PRICING, normalizeBedrockModelId } from "./bedrock";
import { GROQ_MODEL_PRICING } from "./groq";
import type { TokenRate } from "./types";
import {
  isVendorPricedProvider,
  lookupVendorRates,
  normalizeVendorModelId,
  VENDOR_MODEL_PRICING,
  VENDOR_PRICED_PROVIDERS,
  type VendorPricedProvider,
} from "./vendors";

export type RateProvider = "groq" | "bedrock" | VendorPricedProvider;

export function isRateProvider(value: unknown): value is RateProvider {
  return (
    value === "groq" ||
    value === "bedrock" ||
    (typeof value === "string" && isVendorPricedProvider(value))
  );
}

export type RateOverrideMap = Record<string, TokenRate>;

export type EditableRateRow = {
  provider: RateProvider;
  model: string;
  inputPerM: number;
  outputPerM: number;
  /** list = curated table; override = Admin edit; floor = catalog model with no published rate yet. */
  source: "list" | "override" | "floor";
};

const MAX_MODEL_ID = 200;
const MAX_RATE = 10_000;

export function overrideKey(provider: string, model: string): string {
  const p = provider.toLowerCase();
  const m =
    p === "bedrock"
      ? normalizeBedrockModelId(model)
      : isVendorPricedProvider(p)
        ? normalizeVendorModelId(model)
        : model.trim();
  return `${p}:${m}`;
}

export function parseRateOverrides(raw: unknown): RateOverrideMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: RateOverrideMap = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const parsed = parseOverrideKey(key);
    const rates = parseTokenRate(value);
    if (!parsed || !rates) continue;
    out[overrideKey(parsed.provider, parsed.model)] = rates;
  }
  return out;
}

export function parseOverrideKey(key: string): { provider: RateProvider; model: string } | null {
  const cut = key.indexOf(":");
  if (cut <= 0) return null;
  const provider = key.slice(0, cut).toLowerCase();
  const model = key.slice(cut + 1).trim();
  if (!isRateProvider(provider)) return null;
  if (!model || model.length > MAX_MODEL_ID) return null;
  return { provider, model };
}

export function parseTokenRate(value: unknown): TokenRate | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const rec = value as Record<string, unknown>;
  const inputPerM = Number(rec.inputPerM);
  const outputPerM = Number(rec.outputPerM);
  if (!Number.isFinite(inputPerM) || !Number.isFinite(outputPerM)) return null;
  if (inputPerM < 0 || outputPerM < 0 || inputPerM > MAX_RATE || outputPerM > MAX_RATE) {
    return null;
  }
  return { inputPerM, outputPerM };
}

export function lookupOverride(
  provider: string,
  model: string,
  overrides: RateOverrideMap | undefined,
): TokenRate | null {
  if (!overrides) return null;
  const exact = overrides[overrideKey(provider, model)];
  if (exact) return exact;

  // Vendor rows are model-family prefixes ("gpt-4.1"), so an override on a prefix
  // also prices its variants. Longest matching prefix wins.
  const p = provider.toLowerCase();
  if (!isVendorPricedProvider(p)) return null;
  const id = normalizeVendorModelId(model);
  const head = `${p}:`;
  let best: { len: number; rates: TokenRate } | null = null;
  for (const [key, rates] of Object.entries(overrides)) {
    if (!key.startsWith(head)) continue;
    const prefix = key.slice(head.length);
    if (id.startsWith(prefix) && (!best || prefix.length > best.len)) {
      best = { len: prefix.length, rates };
    }
  }
  return best?.rates ?? null;
}

export function ratesEqual(a: TokenRate, b: TokenRate): boolean {
  return a.inputPerM === b.inputPerM && a.outputPerM === b.outputPerM;
}

export function catalogRate(provider: RateProvider, model: string): TokenRate | null {
  if (provider === "groq") return GROQ_MODEL_PRICING[model] ?? null;
  if (provider !== "bedrock") return lookupVendorRates(provider, model);
  return BEDROCK_MODEL_PRICING[normalizeBedrockModelId(model)]
    ?? BEDROCK_MODEL_PRICING[model]
    ?? null;
}

/**
 * Persist only diffs from the curated tables so Reset = clear the map.
 */
export function overridesFromEditedRows(
  rows: EditableRateRow[],
  floor?: TokenRate,
): RateOverrideMap {
  const out: RateOverrideMap = {};
  for (const row of rows) {
    if (!isRateProvider(row.provider)) continue;
    const rates = parseTokenRate({ inputPerM: row.inputPerM, outputPerM: row.outputPerM });
    if (!rates) continue;
    const model =
      row.provider === "bedrock"
        ? normalizeBedrockModelId(row.model)
        : isVendorPricedProvider(row.provider)
          ? normalizeVendorModelId(row.model)
          : row.model.trim();
    if (!model) continue;
    const catalog = catalogRate(row.provider, model);
    if (catalog && ratesEqual(catalog, rates)) continue;
    // An untouched floor row is not a chosen price. Saving the table must not
    // freeze the Max-tier stand-in as if it were a published rate.
    if (!catalog && floor && ratesEqual(rates, floor)) continue;
    out[overrideKey(row.provider, model)] = rates;
  }
  return out;
}

export function listEditableRates(
  overrides: RateOverrideMap,
  extras?: { groqModelIds?: string[]; floor?: TokenRate },
): EditableRateRow[] {
  const seen = new Set<string>();
  const rows: EditableRateRow[] = [];

  const push = (provider: RateProvider, model: string) => {
    const key = overrideKey(provider, model);
    if (seen.has(key)) return;
    seen.add(key);
    const over = overrides[key];
    const catalog = catalogRate(provider, model);
    const rates = over ?? catalog;
    if (!rates) return;
    rows.push({
      provider,
      model,
      inputPerM: rates.inputPerM,
      outputPerM: rates.outputPerM,
      source: over ? "override" : "list",
    });
  };

  for (const model of Object.keys(BEDROCK_MODEL_PRICING)) push("bedrock", model);
  for (const model of Object.keys(GROQ_MODEL_PRICING)) push("groq", model);
  for (const vendor of VENDOR_PRICED_PROVIDERS) {
    for (const entry of VENDOR_MODEL_PRICING[vendor]) push(vendor, entry.prefix);
  }

  const floor = extras?.floor;
  for (const model of extras?.groqModelIds ?? []) {
    const key = overrideKey("groq", model);
    if (seen.has(key) || !model.trim()) continue;
    if (!floor) continue;
    seen.add(key);
    const over = overrides[key];
    const rates = over ?? floor;
    rows.push({
      provider: "groq",
      model: model.trim(),
      inputPerM: rates.inputPerM,
      outputPerM: rates.outputPerM,
      source: over ? "override" : "floor",
    });
  }

  for (const key of Object.keys(overrides)) {
    const parsed = parseOverrideKey(key);
    if (!parsed) continue;
    push(parsed.provider, parsed.model);
  }

  return rows;
}
