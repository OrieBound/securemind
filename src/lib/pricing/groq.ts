/**
 * Groq published list rates for estimated inference cost.
 * Update GROQ_PRICING_VERSION + table when console.groq.com/docs/models rates change.
 * There is no official Groq pricing API — refresh manually (or via scripts/check-pricing.mjs notes).
 */

import { costFromRates, type TokenRate } from "./types";

export const GROQ_PRICING_VERSION = "groq-list-2026-09";
export const GROQ_PRICING_EFFECTIVE = "2026-09-22";

/**
 * USD per million tokens (input / output).
 * Production rates from console.groq.com/docs/models; Plus/Light keep router-documented
 * rates when those ids are preview/rotated (re-check with `npm run pricing:check`).
 */
export const GROQ_MODEL_PRICING: Record<string, TokenRate> = {
  "llama-3.3-70b-versatile":                   { inputPerM: 0.59,  outputPerM: 0.79 },
  "qwen/qwen3-32b":                            { inputPerM: 0.29,  outputPerM: 0.59 },
  "openai/gpt-oss-120b":                       { inputPerM: 0.15,  outputPerM: 0.60 },
  "meta-llama/llama-4-scout-17b-16e-instruct": { inputPerM: 0.11,  outputPerM: 0.34 },
  "openai/gpt-oss-20b":                        { inputPerM: 0.075, outputPerM: 0.30 },
  "llama-3.1-8b-instant":                      { inputPerM: 0.05,  outputPerM: 0.08 },
  // Preview rate from console.groq.com/docs/models on 2026-09-22.
  "qwen/qwen3.8-27b":                          { inputPerM: 0.80,  outputPerM: 4.00 },
};

/** Documented premium baseline for routing-savings charts — not AWS savings. */
export const DEFAULT_COST_BASELINE_MODEL = "llama-3.3-70b-versatile";

export function estimateGroqTurnCostUsd(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number | null {
  const p = GROQ_MODEL_PRICING[model];
  if (!p) return null;
  return costFromRates(p, promptTokens, completionTokens);
}

/** @deprecated Prefer estimateInferenceCost from `@/lib/pricing` — kept for call sites. */
export function estimateTurnCostUsd(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number | null {
  return estimateGroqTurnCostUsd(model, promptTokens, completionTokens);
}

export function estimateBaselineCostUsd(
  promptTokens: number,
  completionTokens: number,
  baselineModel = DEFAULT_COST_BASELINE_MODEL,
): number | null {
  return estimateGroqTurnCostUsd(baselineModel, promptTokens, completionTokens);
}

export function estimateRoutingSavingsUsd(
  model: string,
  promptTokens: number,
  completionTokens: number,
  baselineModel = DEFAULT_COST_BASELINE_MODEL,
): number | null {
  const actual = estimateGroqTurnCostUsd(model, promptTokens, completionTokens);
  const baseline = estimateBaselineCostUsd(promptTokens, completionTokens, baselineModel);
  if (actual == null || baseline == null) return null;
  return Math.max(0, baseline - actual);
}
