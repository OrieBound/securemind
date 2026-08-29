/**
 * Client-safe monthly cost-cap helpers. Do not import @/lib/db here.
 */

export const DEFAULT_MONTHLY_COST_CAP_USD = 10;

export const COST_CAP_EXCEEDED_CODE = "cost_cap_exceeded";

export const COST_CAP_EXCEEDED_MESSAGE =
  "Estimated monthly cost cap reached. Billable external model calls are paused until an Admin raises the cap. Local models can still run. Provider invoices remain authoritative.";

export const MAX_MONTHLY_COST_CAP_USD = 100_000;

export const BILLABLE_INFERENCE_PROVIDERS = new Set([
  "groq",
  "bedrock",
  "openai",
  "anthropic",
  "google",
]);

export type CostCapWarningLevel = "none" | "warn50" | "warn80" | "blocked";

export type CostCapStatus = {
  capped: boolean;
  spentUsd: number;
  capUsd: number | null;
  resetsAt: string;
  warningLevel: CostCapWarningLevel;
};

export function costCapWarningLevel(
  capUsd: number | null,
  spentUsd: number,
): CostCapWarningLevel {
  if (capUsd == null || capUsd <= 0) return "none";
  const ratio = spentUsd / capUsd;
  if (ratio >= 1) return "blocked";
  if (ratio >= 0.8) return "warn80";
  if (ratio >= 0.5) return "warn50";
  return "none";
}

export function isBillableInferenceProvider(provider: string): boolean {
  return BILLABLE_INFERENCE_PROVIDERS.has(provider);
}

export function parseMonthlyCostCapInput(
  raw: unknown,
): { ok: true; value: number | null | undefined } | { ok: false; error: string } {
  if (raw === undefined) return { ok: true, value: undefined };
  if (raw === null) return { ok: true, value: null };
  if (typeof raw === "string" && raw.trim().toLowerCase() === "unlimited") {
    return { ok: true, value: null };
  }
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n <= 0) {
    return { ok: false, error: "monthlyCostCapUsd must be a number greater than zero, or null (unlimited)." };
  }
  const rounded = Math.round(n * 100) / 100;
  if (Math.abs(n - rounded) > 1e-9) {
    return { ok: false, error: "monthlyCostCapUsd may have at most two decimal places." };
  }
  if (rounded > MAX_MONTHLY_COST_CAP_USD) {
    return { ok: false, error: `monthlyCostCapUsd cannot exceed ${MAX_MONTHLY_COST_CAP_USD}.` };
  }
  return { ok: true, value: rounded };
}

export function formatUsdLabeled(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "Unlimited";
  if (n === 0) return "$0.00 USD";
  if (n < 0.01) return `$${n.toFixed(4)} USD`;
  return `$${n.toFixed(2)} USD`;
}
