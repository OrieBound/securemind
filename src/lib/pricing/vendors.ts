/**
 * Approximate list rates for the direct vendor APIs (Gemini, OpenAI, Anthropic, Grok).
 *
 * Unlike Groq and Bedrock, these vendors change model names often and publish no
 * stable pricing API, so rates are matched by model-id *prefix*, most specific first.
 * Figures come from third-party aggregators in 2026-10 and were NOT verified against
 * the vendors' own pages. Where sources disagreed the higher number is used, and an
 * unmatched model falls back to a per-vendor ceiling, so a cap is never bypassed by a
 * new model id. Admins can set exact rates under Cost → Rates (overrides win).
 * Refresh this table and VENDOR_PRICING_VERSION together.
 */

import type { TokenRate } from "./types";

export const VENDOR_PRICING_VERSION = "vendor-approx-2026-10";
export const VENDOR_PRICING_EFFECTIVE = "2026-10-16";

export type VendorPricedProvider = "google" | "openai" | "anthropic" | "xai";

export const VENDOR_PRICED_PROVIDERS: readonly VendorPricedProvider[] = [
  "google",
  "openai",
  "anthropic",
  "xai",
];

type VendorRateEntry = TokenRate & { prefix: string };

/** Most specific prefix first within each vendor. */
export const VENDOR_MODEL_PRICING: Record<VendorPricedProvider, VendorRateEntry[]> = {
  openai: [
    { prefix: "gpt-5.5", inputPerM: 5, outputPerM: 30 },
    { prefix: "gpt-5.4-nano", inputPerM: 0.2, outputPerM: 1.25 },
    { prefix: "gpt-4.1-nano", inputPerM: 0.1, outputPerM: 0.4 },
    { prefix: "gpt-4.1-mini", inputPerM: 0.4, outputPerM: 1.6 },
    { prefix: "gpt-4.1", inputPerM: 2, outputPerM: 8 },
    { prefix: "gpt-4o-mini", inputPerM: 0.15, outputPerM: 0.6 },
    { prefix: "gpt-4o", inputPerM: 2.5, outputPerM: 10 },
  ],
  anthropic: [
    // Opus 4 / 4.1 were $15/$75; 4.5 and later are $5/$25. Match the old ones first.
    { prefix: "claude-opus-4-1", inputPerM: 15, outputPerM: 75 },
    { prefix: "claude-opus-4-2025", inputPerM: 15, outputPerM: 75 },
    { prefix: "claude-opus", inputPerM: 5, outputPerM: 25 },
    { prefix: "claude-sonnet", inputPerM: 3, outputPerM: 15 },
    { prefix: "claude-haiku-4", inputPerM: 1, outputPerM: 5 },
    { prefix: "claude-3-5-haiku", inputPerM: 0.8, outputPerM: 4 },
    { prefix: "claude-3-haiku", inputPerM: 0.25, outputPerM: 1.25 },
  ],
  google: [
    { prefix: "gemini-3.5-flash", inputPerM: 1.5, outputPerM: 9 },
    { prefix: "gemini-3.1-pro", inputPerM: 2, outputPerM: 12 },
    { prefix: "gemini-2.5-flash-lite", inputPerM: 0.1, outputPerM: 0.4 },
    { prefix: "gemini-2.5-flash", inputPerM: 0.3, outputPerM: 2.5 },
    // Prompts over 200K tokens cost more; this is the standard-context rate.
    { prefix: "gemini-2.5-pro", inputPerM: 1.25, outputPerM: 10 },
    { prefix: "gemini-2.0-flash", inputPerM: 0.1, outputPerM: 0.4 },
  ],
  xai: [
    { prefix: "grok-4.1-fast", inputPerM: 0.2, outputPerM: 0.5 },
    { prefix: "grok-4.3", inputPerM: 1.25, outputPerM: 2.5 },
    { prefix: "grok-4", inputPerM: 2, outputPerM: 6 },
    { prefix: "grok-3", inputPerM: 3, outputPerM: 15 },
  ],
};

/**
 * Ceiling for a model id no prefix matches. Set near each vendor's premium tier so a
 * new or renamed model is over- rather than under-counted against the monthly cap.
 */
export const VENDOR_FLOOR_RATES: Record<VendorPricedProvider, TokenRate> = {
  openai: { inputPerM: 5, outputPerM: 30 },
  anthropic: { inputPerM: 5, outputPerM: 25 },
  google: { inputPerM: 2, outputPerM: 12 },
  xai: { inputPerM: 3, outputPerM: 15 },
};

export function isVendorPricedProvider(provider: string): provider is VendorPricedProvider {
  return (VENDOR_PRICED_PROVIDERS as readonly string[]).includes(provider);
}

/** Gemini lists ids as "models/gemini-…"; compare on the bare id. */
export function normalizeVendorModelId(model: string): string {
  return model.trim().toLowerCase().replace(/^models\//, "");
}

export function lookupVendorRates(provider: string, model: string): TokenRate | null {
  const p = provider.toLowerCase();
  if (!isVendorPricedProvider(p)) return null;
  const id = normalizeVendorModelId(model);
  const hit = VENDOR_MODEL_PRICING[p].find(entry => id.startsWith(entry.prefix));
  return hit ? { inputPerM: hit.inputPerM, outputPerM: hit.outputPerM } : null;
}

export function vendorFloorRates(provider: string): TokenRate | null {
  const p = provider.toLowerCase();
  return isVendorPricedProvider(p) ? VENDOR_FLOOR_RATES[p] : null;
}
