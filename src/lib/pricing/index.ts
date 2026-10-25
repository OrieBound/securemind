/**
 * Multi-provider list-price cost estimates for Insights / analytics / caps.
 * Estimates apply a conservative uplift so displayed/enforced spend tends high
 * vs raw list rate. Not invoices, credits, or enterprise discounts.
 */

import {
  DEFAULT_COST_BASELINE_MODEL,
  estimateBaselineCostUsd,
  estimateGroqTurnCostUsd,
  GROQ_MODEL_PRICING,
  GROQ_PRICING_EFFECTIVE,
  GROQ_PRICING_VERSION,
} from "./groq";
import {
  BEDROCK_PRICING_EFFECTIVE,
  BEDROCK_PRICING_VERSION,
  estimateBedrockTurnCostUsd,
  lookupBedrockRates,
} from "./bedrock";
import {
  isVendorPricedProvider,
  lookupVendorRates,
  VENDOR_PRICING_EFFECTIVE,
  VENDOR_PRICING_VERSION,
  vendorFloorRates,
} from "./vendors";
import { costFromRates, type CostEstimate, type TokenRate } from "./types";
import { lookupOverride, type RateOverrideMap } from "./rate-overrides";

export type { CostEstimate, TokenRate } from "./types";
export {
  DEFAULT_COST_BASELINE_MODEL,
  GROQ_MODEL_PRICING,
  GROQ_PRICING_VERSION,
  GROQ_PRICING_EFFECTIVE,
  estimateGroqTurnCostUsd,
  estimateBaselineCostUsd,
  estimateRoutingSavingsUsd,
  estimateTurnCostUsd,
} from "./groq";
export {
  BEDROCK_MODEL_PRICING,
  BEDROCK_PRICING_VERSION,
  BEDROCK_PRICING_EFFECTIVE,
  normalizeBedrockModelId,
  lookupBedrockRates,
  estimateBedrockTurnCostUsd,
} from "./bedrock";

export {
  VENDOR_MODEL_PRICING,
  VENDOR_FLOOR_RATES,
  VENDOR_PRICING_VERSION,
  VENDOR_PRICING_EFFECTIVE,
  lookupVendorRates,
  vendorFloorRates,
} from "./vendors";

export const OLLAMA_PRICING_VERSION = "ollama-local-zero";

/** Bundle stamp for Cost Insights chrome (all curated tables). */
export const PRICING_BUNDLE_VERSION = `${GROQ_PRICING_VERSION}+${BEDROCK_PRICING_VERSION}+${VENDOR_PRICING_VERSION}+c10`;
export const PRICING_BUNDLE_EFFECTIVE = [
  GROQ_PRICING_EFFECTIVE,
  BEDROCK_PRICING_EFFECTIVE,
  VENDOR_PRICING_EFFECTIVE,
].reduce((oldest, d) => (d < oldest ? d : oldest));

/** Applied on top of list rates before persistence / cap math. */
export const CONSERVATIVE_COST_UPLIFT = 0.1;

/** Round up to this quantum (USD) after uplift. */
export const COST_ROUND_UP_QUANTUM = 0.0001;

/**
 * Floor rates for unpriced cloud models — Max-tier Groq list rates so caps
 * cannot be bypassed by unknown model ids.
 */
export const UNPRICED_CLOUD_FLOOR_RATES: TokenRate =
  GROQ_MODEL_PRICING[DEFAULT_COST_BASELINE_MODEL] ?? {
    inputPerM: 0.59,
    outputPerM: 0.79,
  };

export const UNPRICED_CLOUD_FLOOR_VERSION = `${GROQ_PRICING_VERSION}+floor-${DEFAULT_COST_BASELINE_MODEL}`;

export const COST_ESTIMATE_DISCLAIMER =
  "Estimated from recorded tokens × list rates (Groq / Bedrock on-demand; Gemini, OpenAI, Anthropic and Grok use approximate rates matched by model family; local Ollama is $0) with a +10% conservative uplift, rounded up. Not an invoice — provider billing is not queried, and a free tier is still estimated at list rate. Unmatched models use a per-vendor ceiling. Admins can set exact rates on this page; changes apply to new turns only.";

/** Ceiling after uplift so estimates never under-count vs raw list rate. */
export function applyConservativeUplift(rawUsd: number): number {
  if (!Number.isFinite(rawUsd) || rawUsd <= 0) return 0;
  const uplifted = rawUsd * (1 + CONSERVATIVE_COST_UPLIFT);
  return Math.ceil(uplifted / COST_ROUND_UP_QUANTUM) * COST_ROUND_UP_QUANTUM;
}

function withConservative(est: CostEstimate): CostEstimate {
  if (est.estimatedCostUsd == null) return est;
  return {
    ...est,
    estimatedCostUsd: applyConservativeUplift(est.estimatedCostUsd),
  };
}

/**
 * Price one inference turn for analytics and caps.
 * - groq / bedrock: list-rate math when the model is in the table; else Max-tier floor
 * - ollama: $0 (local) — still “priced” so it does not inflate unpriced counts
 */
export function estimateInferenceCost(opts: {
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  rateOverrides?: RateOverrideMap;
}): CostEstimate {
  const provider = opts.provider.toLowerCase();
  const { model, promptTokens, completionTokens } = opts;

  if (provider === "ollama") {
    return {
      estimatedCostUsd: 0,
      pricingVersion: OLLAMA_PRICING_VERSION,
      priced: true,
    };
  }

  const override = lookupOverride(provider, model, opts.rateOverrides);
  if (override) {
    return withConservative({
      estimatedCostUsd: costFromRates(override, promptTokens, completionTokens),
      pricingVersion: `${PRICING_BUNDLE_VERSION}+override`,
      priced: true,
    });
  }

  if (provider === "groq") {
    const usd = estimateGroqTurnCostUsd(model, promptTokens, completionTokens);
    if (usd != null) {
      return withConservative({
        estimatedCostUsd: usd,
        pricingVersion: GROQ_PRICING_VERSION,
        priced: true,
      });
    }
    const floor = costFromRates(UNPRICED_CLOUD_FLOOR_RATES, promptTokens, completionTokens);
    return withConservative({
      estimatedCostUsd: floor,
      pricingVersion: UNPRICED_CLOUD_FLOOR_VERSION,
      priced: true,
    });
  }

  if (provider === "bedrock") {
    const usd = estimateBedrockTurnCostUsd(model, promptTokens, completionTokens);
    if (usd != null) {
      return withConservative({
        estimatedCostUsd: usd,
        pricingVersion: BEDROCK_PRICING_VERSION,
        priced: true,
      });
    }
    const floor = costFromRates(UNPRICED_CLOUD_FLOOR_RATES, promptTokens, completionTokens);
    return withConservative({
      estimatedCostUsd: floor,
      pricingVersion: UNPRICED_CLOUD_FLOOR_VERSION,
      priced: true,
    });
  }

  if (isVendorPricedProvider(provider)) {
    const matched = lookupVendorRates(provider, model);
    // No prefix match: use the vendor's premium-tier ceiling, not the Groq floor,
    // which would under-count a new Claude/GPT model against the cap.
    const rates = matched ?? vendorFloorRates(provider) ?? UNPRICED_CLOUD_FLOOR_RATES;
    return withConservative({
      estimatedCostUsd: costFromRates(rates, promptTokens, completionTokens),
      pricingVersion: matched
        ? VENDOR_PRICING_VERSION
        : `${VENDOR_PRICING_VERSION}+floor-${provider}`,
      priced: true,
    });
  }

  // Unknown cloud-ish provider: still apply floor so caps are not bypassed.
  const floor = costFromRates(UNPRICED_CLOUD_FLOOR_RATES, promptTokens, completionTokens);
  return withConservative({
    estimatedCostUsd: floor,
    pricingVersion: UNPRICED_CLOUD_FLOOR_VERSION,
    priced: true,
  });
}

/** Routing savings vs a Groq baseline (default Max-tier list model). */
export function estimateSavingsVsBaseline(opts: {
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  baselineModel?: string;
}): number | null {
  const actual = estimateInferenceCost(opts);
  if (!actual.priced || actual.estimatedCostUsd == null) return null;
  const baselineRaw = estimateBaselineCostUsd(
    opts.promptTokens,
    opts.completionTokens,
    opts.baselineModel ?? DEFAULT_COST_BASELINE_MODEL,
  );
  if (baselineRaw == null) return null;
  const baseline = applyConservativeUplift(baselineRaw);
  return Math.max(0, baseline - actual.estimatedCostUsd);
}

export function hasListPrice(
  provider: string,
  model: string,
  rateOverrides?: RateOverrideMap,
): boolean {
  const p = provider.toLowerCase();
  if (p === "ollama") return true;
  if (lookupOverride(p, model, rateOverrides)) return true;
  if (p === "groq") return model in GROQ_MODEL_PRICING;
  if (p === "bedrock") return lookupBedrockRates(model) != null;
  if (isVendorPricedProvider(p)) return lookupVendorRates(p, model) != null;
  return false;
}
