/** Shared shapes for list-price cost estimates (not invoices). */

export type TokenRate = {
  /** USD per million input tokens */
  inputPerM: number;
  /** USD per million output tokens */
  outputPerM: number;
};

export type CostEstimate = {
  /** null = unknown rate — never treat as $0 */
  estimatedCostUsd: number | null;
  pricingVersion: string | null;
  /** True when a rate table entry produced a number (incl. Ollama $0). */
  priced: boolean;
};

export function costFromRates(
  rates: TokenRate,
  promptTokens: number,
  completionTokens: number,
): number {
  return (promptTokens * rates.inputPerM + completionTokens * rates.outputPerM) / 1_000_000;
}
