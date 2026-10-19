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

function acceptedModel(
  id: string | undefined,
  canRun?: (modelId: string) => boolean,
): string | null {
  const trimmed = id?.trim() ?? "";
  if (!trimmed || !isChatUsableModelId(trimmed)) return null;
  if (canRun && !canRun(trimmed)) return null;
  return trimmed;
}

/**
 * The map posted as `modelOverrides` — every key is a model the matching
 * Insights row is showing, so the server honors the same assignment.
 * `canRun` drops ids chat cannot run, including a saved Groq key whose model list failed.
 */
export function effectiveTierOverrides(opts: {
  selectionMode: "auto" | "fixed";
  fixedModelId: string;
  overrides: Record<string, string>;
  /** Groq (or equivalent cloud default) can actually run this session. */
  cloudDefaultsWillRun: boolean;
  canRun?: (modelId: string) => boolean;
}): Record<string, string> {
  if (opts.selectionMode === "fixed") {
    const id = acceptedModel(opts.fixedModelId, opts.canRun);
    if (!id) return {};
    return Object.fromEntries(COMPLEXITY_TIER_NAMES.map(t => [t, id]));
  }

  const cleaned = sanitizeTierOverrides(opts.overrides);
  const out: Record<string, string> = {};
  for (const tier of COMPLEXITY_TIER_NAMES) {
    const explicit = acceptedModel(cleaned[tier], opts.canRun);
    if (explicit) {
      out[tier] = explicit;
      continue;
    }
    if (opts.cloudDefaultsWillRun) {
      const fallback = acceptedModel(DEFAULT_TIER_MODELS[tier], opts.canRun);
      if (fallback) out[tier] = fallback;
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
  canRun?: (modelId: string) => boolean;
}): string {
  const cleaned = sanitizeTierOverrides(opts.overrides);
  const explicit = isComplexityTierName(opts.tier)
    ? acceptedModel(cleaned[opts.tier], opts.canRun)
    : null;
  if (explicit) return explicit;
  if (opts.cloudDefaultsWillRun && isComplexityTierName(opts.tier)) {
    const fallback = acceptedModel(DEFAULT_TIER_MODELS[opts.tier], opts.canRun);
    if (fallback) return fallback;
  }
  if (opts.localFallbackModel) return opts.localFallbackModel;
  return "";
}
