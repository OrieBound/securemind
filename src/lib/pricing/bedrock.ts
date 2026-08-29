/**
 * Amazon Bedrock on-demand list rates for estimated inference cost (USD / million tokens).
 *
 * Source of truth: curated table checked against https://aws.amazon.com/bedrock/pricing/
 * AWS Price List API (GetProducts / AmazonBedrockFoundationModels) is incomplete for many
 * newer models — use scripts/check-pricing.mjs as a best-effort refresh aid, then edit this file.
 *
 * Rates are typically for us-east-1 on-demand; other regions may differ slightly.
 */

import { costFromRates, type TokenRate } from "./types";

export const BEDROCK_PRICING_VERSION = "bedrock-list-2026-08";
export const BEDROCK_PRICING_EFFECTIVE = "2026-08-01";

/**
 * Keys are foundation model ids (without cross-region prefix).
 * Inference profile ids like `us.amazon.nova-lite-v1:0` normalize to `amazon.nova-lite-v1:0`.
 */
export const BEDROCK_MODEL_PRICING: Record<string, TokenRate> = {
  // Amazon Nova — aws.amazon.com/bedrock/pricing (on-demand)
  "amazon.nova-micro-v1:0":   { inputPerM: 0.035, outputPerM: 0.14 },
  "amazon.nova-lite-v1:0":    { inputPerM: 0.06,  outputPerM: 0.24 },
  "amazon.nova-pro-v1:0":     { inputPerM: 0.80,  outputPerM: 3.20 },
  "amazon.nova-premier-v1:0": { inputPerM: 2.50,  outputPerM: 12.50 },

  // Anthropic Claude (common on-demand; regional / PEA tiers may differ — treat as estimate)
  "anthropic.claude-3-haiku-20240307-v1:0":    { inputPerM: 0.25,  outputPerM: 1.25 },
  "anthropic.claude-3-5-haiku-20241022-v1:0":  { inputPerM: 0.80,  outputPerM: 4.00 },
  "anthropic.claude-3-5-sonnet-20240620-v1:0": { inputPerM: 3.00,  outputPerM: 15.00 },
  "anthropic.claude-3-5-sonnet-20241022-v2:0": { inputPerM: 3.00,  outputPerM: 15.00 },
  "anthropic.claude-3-7-sonnet-20250219-v1:0": { inputPerM: 3.00,  outputPerM: 15.00 },
  "anthropic.claude-sonnet-4-20250514-v1:0":    { inputPerM: 3.00,  outputPerM: 15.00 },
  "anthropic.claude-opus-4-20250514-v1:0":      { inputPerM: 15.00, outputPerM: 75.00 },

  // Meta Llama on Bedrock (representative on-demand)
  "meta.llama3-1-8b-instruct-v1:0":  { inputPerM: 0.22, outputPerM: 0.22 },
  "meta.llama3-1-70b-instruct-v1:0": { inputPerM: 0.72, outputPerM: 0.72 },
  "meta.llama3-3-70b-instruct-v1:0": { inputPerM: 0.72, outputPerM: 0.72 },
};

/** Strip cross-region inference profile prefixes (us. / eu. / apac. / global.). */
export function normalizeBedrockModelId(modelId: string): string {
  return modelId.trim().replace(/^(us|eu|apac|global)\./i, "");
}

export function lookupBedrockRates(modelId: string): TokenRate | null {
  const raw = modelId.trim();
  if (BEDROCK_MODEL_PRICING[raw]) return BEDROCK_MODEL_PRICING[raw]!;
  const normalized = normalizeBedrockModelId(raw);
  if (BEDROCK_MODEL_PRICING[normalized]) return BEDROCK_MODEL_PRICING[normalized]!;
  // Match by suffix (handles slight id drift)
  for (const [key, rates] of Object.entries(BEDROCK_MODEL_PRICING)) {
    if (normalized.endsWith(key) || key.endsWith(normalized)) return rates;
  }
  return null;
}

export function estimateBedrockTurnCostUsd(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number | null {
  const rates = lookupBedrockRates(model);
  if (!rates) return null;
  return costFromRates(rates, promptTokens, completionTokens);
}
