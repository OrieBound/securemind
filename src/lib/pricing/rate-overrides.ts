/**
 * Sparse Admin overrides on top of curated Groq / Bedrock list rates.
 * Past inference events keep the rates they were recorded with.
 */

import { BEDROCK_MODEL_PRICING, normalizeBedrockModelId } from "./bedrock";
import { GROQ_MODEL_PRICING } from "./groq";
import type { TokenRate } from "./types";

export type RateProvider = "groq" | "bedrock";

export type RateOverrideMap = Record<string, TokenRate>;

export type EditableRateRow = {
  provider: RateProvider;
  model: string;
  inputPerM: number;
  outputPerM: number;
  source: "list" | "override";
};

const MAX_MODEL_ID = 200;
const MAX_RATE = 10_000;

export function overrideKey(provider: string, model: string): string {
  const p = provider.toLowerCase();
  const m = p === "bedrock" ? normalizeBedrockModelId(model) : model.trim();
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
  if (provider !== "groq" && provider !== "bedrock") return null;
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
  return overrides[overrideKey(provider, model)] ?? null;
}

export function ratesEqual(a: TokenRate, b: TokenRate): boolean {
  return a.inputPerM === b.inputPerM && a.outputPerM === b.outputPerM;
}

export function catalogRate(provider: RateProvider, model: string): TokenRate | null {
  if (provider === "groq") return GROQ_MODEL_PRICING[model] ?? null;
  return BEDROCK_MODEL_PRICING[normalizeBedrockModelId(model)]
    ?? BEDROCK_MODEL_PRICING[model]
    ?? null;
}

/**
 * Persist only diffs from the curated tables so Reset = clear the map.
 */
export function overridesFromEditedRows(rows: EditableRateRow[]): RateOverrideMap {
  const out: RateOverrideMap = {};
  for (const row of rows) {
    if (row.provider !== "groq" && row.provider !== "bedrock") continue;
    const rates = parseTokenRate({ inputPerM: row.inputPerM, outputPerM: row.outputPerM });
    if (!rates) continue;
    const model = row.provider === "bedrock" ? normalizeBedrockModelId(row.model) : row.model.trim();
    if (!model) continue;
    const catalog = catalogRate(row.provider, model);
    if (catalog && ratesEqual(catalog, rates)) continue;
    out[overrideKey(row.provider, model)] = rates;
  }
  return out;
}

export function listEditableRates(overrides: RateOverrideMap): EditableRateRow[] {
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

  for (const key of Object.keys(overrides)) {
    const parsed = parseOverrideKey(key);
    if (!parsed) continue;
    push(parsed.provider, parsed.model);
  }

  return rows;
}
