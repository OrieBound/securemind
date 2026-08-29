/**
 * Client-safe mapping from complexity tier → model the UI shows and chat sends.
 * Keep in sync with COMPLEXITY_TIERS in router.ts.
 */

import { isChatUsableModelId } from "./catalog-shared";

export const COMPLEXITY_TIER_NAMES = ["Max", "Plus", "Standard", "Light", "Micro"] as const;
export type ComplexityTierName = (typeof COMPLEXITY_TIER_NAMES)[number];

export const DEFAULT_TIER_MODELS: Record<ComplexityTierName, string> = {
  Max: "llama-3.3-70b-versatile",
  Plus: "qwen/qwen3-32b",
  Standard: "openai/gpt-oss-120b",
  Light: "meta-llama/llama-4-scout-17b-16e-instruct",
  Micro: "llama-3.1-8b-instant",
};

export function isComplexityTierName(value: string): value is ComplexityTierName {
  return (COMPLEXITY_TIER_NAMES as readonly string[]).includes(value);
}

/** Drop TTS / image / guard ids that may still sit in localStorage. */
export function sanitizeTierOverrides(raw: Record<string, string>): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [tier, id] of Object.entries(raw)) {
    if (!isComplexityTierName(tier)) continue;
    const trimmed = id.trim();
    if (trimmed && isChatUsableModelId(trimmed)) next[tier] = trimmed;
  }
  return next;
}

/**
 * The map posted as `modelOverrides` — every key is a model the matching
 * Insights row is showing, so the server honors the same assignment.
 */
export function effectiveTierOverrides(opts: {
  selectionMode: "auto" | "fixed";
  fixedModelId: string;
  overrides: Record<string, string>;
  /** Groq (or equivalent cloud default) can actually run this session. */
  cloudDefaultsWillRun: boolean;
}): Record<string, string> {
  if (opts.selectionMode === "fixed") {
    const id = opts.fixedModelId.trim();
    if (!id || !isChatUsableModelId(id)) return {};
    return Object.fromEntries(COMPLEXITY_TIER_NAMES.map(t => [t, id]));
  }

  const cleaned = sanitizeTierOverrides(opts.overrides);
  const out: Record<string, string> = {};
  for (const tier of COMPLEXITY_TIER_NAMES) {
    if (cleaned[tier]) {
      out[tier] = cleaned[tier];
      continue;
    }
    if (opts.cloudDefaultsWillRun) {
      out[tier] = DEFAULT_TIER_MODELS[tier];
    }
  }
  return out;
}

/** Model id the Insights row should display for a tier. */
export function displayModelForTier(opts: {
  tier: string;
  overrides: Record<string, string>;
  cloudDefaultsWillRun: boolean;
  localFallbackModel: string | null;
}): string {
  const cleaned = sanitizeTierOverrides(opts.overrides);
  if (isComplexityTierName(opts.tier) && cleaned[opts.tier]) return cleaned[opts.tier];
  if (opts.cloudDefaultsWillRun && isComplexityTierName(opts.tier)) {
    return DEFAULT_TIER_MODELS[opts.tier];
  }
  if (opts.localFallbackModel) return opts.localFallbackModel;
  return isComplexityTierName(opts.tier)
    ? DEFAULT_TIER_MODELS[opts.tier]
    : "llama-3.3-70b-versatile";
}
