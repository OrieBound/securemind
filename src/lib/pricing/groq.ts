/**
 * Groq list pricing used for estimated inference cost.
 * Update GROQ_PRICING_VERSION when rates change.
 */

export const GROQ_PRICING_VERSION = "groq-list-2026-08";
export const GROQ_PRICING_EFFECTIVE = "2026-08-01";

/** USD per million tokens (input / output). */
export const GROQ_MODEL_PRICING: Record<string, { inputPerM: number; outputPerM: number }> = {
  "llama-3.3-70b-versatile":                   { inputPerM: 0.59,  outputPerM: 0.79 },
  "qwen/qwen3-32b":                            { inputPerM: 0.29,  outputPerM: 0.59 },
  "openai/gpt-oss-120b":                       { inputPerM: 0.15,  outputPerM: 0.60 },
  "meta-llama/llama-4-scout-17b-16e-instruct": { inputPerM: 0.11,  outputPerM: 0.34 },
  "openai/gpt-oss-20b":                        { inputPerM: 0.075, outputPerM: 0.30 },
  "llama-3.1-8b-instant":                      { inputPerM: 0.05,  outputPerM: 0.08 },
};

/** Documented premium baseline for “routing estimate vs baseline” charts — not AWS savings. */
export const DEFAULT_COST_BASELINE_MODEL = "llama-3.3-70b-versatile";

export function estimateTurnCostUsd(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number | null {
  const p = GROQ_MODEL_PRICING[model];
  if (!p) return null;
  return (promptTokens * p.inputPerM + completionTokens * p.outputPerM) / 1_000_000;
}

export function estimateBaselineCostUsd(
  promptTokens: number,
  completionTokens: number,
  baselineModel = DEFAULT_COST_BASELINE_MODEL,
): number | null {
  return estimateTurnCostUsd(baselineModel, promptTokens, completionTokens);
}

export function estimateRoutingSavingsUsd(
  model: string,
  promptTokens: number,
  completionTokens: number,
  baselineModel = DEFAULT_COST_BASELINE_MODEL,
): number | null {
  const actual = estimateTurnCostUsd(model, promptTokens, completionTokens);
  const baseline = estimateBaselineCostUsd(promptTokens, completionTokens, baselineModel);
  if (actual == null || baseline == null) return null;
  return Math.max(0, baseline - actual);
}
