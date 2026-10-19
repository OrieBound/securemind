/**
 * Per-user monthly USD cost caps (UTC calendar month).
 * Cap null = unlimited. Estimates come from InferenceEvent.estimatedCostUsd.
 */

import { db } from "@/lib/db";
import { LOCAL_USER_ID } from "@/lib/identity";
import { usesHostedAppStore } from "@/lib/workspaces/store";
import { hostedAppStore } from "@/lib/workspaces/hosted-dynamo";
import { hostedInstanceConfig } from "@/lib/instance-config-hosted";
import {
  DEFAULT_MONTHLY_COST_CAP_USD,
  costCapWarningLevel,
  type CostCapStatus,
} from "@/lib/cost-cap-shared";

export {
  BILLABLE_INFERENCE_PROVIDERS,
  COST_CAP_EXCEEDED_CODE,
  COST_CAP_EXCEEDED_MESSAGE,
  DEFAULT_MONTHLY_COST_CAP_USD,
  MAX_MONTHLY_COST_CAP_USD,
  costCapWarningLevel,
  formatUsdLabeled,
  isBillableInferenceProvider,
  parseMonthlyCostCapInput,
  type CostCapStatus,
  type CostCapWarningLevel,
} from "@/lib/cost-cap-shared";

/** Start of current UTC calendar month and first instant of next month (reset). */
export function utcMonthBounds(now = new Date()): { start: Date; resetsAt: Date } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  const resetsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
  return { start, resetsAt };
}

export async function getUserMonthSpendUsd(userId: string, now = new Date()): Promise<number> {
  const map = await getUsersMonthSpendUsd([userId], now);
  return map.get(userId) ?? 0;
}

/** One groupBy for a directory list instead of N monthly aggregates. */
export async function getUsersMonthSpendUsd(
  userIds: string[],
  now = new Date(),
): Promise<Map<string, number>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  const result = new Map(ids.map(id => [id, 0]));
  if (ids.length === 0) return result;
  const { start, resetsAt } = utcMonthBounds(now);
  try {
    if (usesHostedAppStore()) {
      const store = hostedAppStore();
      const fromIso = start.toISOString();
      const untilIso = resetsAt.toISOString();
      await Promise.all(
        ids.map(async id => {
          const events = await store.listInferenceEvents(id, { fromIso });
          let sum = 0;
          for (const e of events) {
            if (e.at >= untilIso) continue;
            if (e.estimatedCostUsd != null) sum += e.estimatedCostUsd;
          }
          result.set(id, sum);
        }),
      );
      return result;
    }
    const rows = await db.inferenceEvent.groupBy({
      by: ["userId"],
      where: {
        userId: { in: ids },
        at: { gte: start, lt: resetsAt },
        estimatedCostUsd: { not: null },
      },
      _sum: { estimatedCostUsd: true },
    });
    for (const row of rows) {
      result.set(row.userId, row._sum.estimatedCostUsd ?? 0);
    }
  } catch (err) {
    console.warn(
      "[cost-cap] monthly spend unavailable",
      err instanceof Error ? err.message : err,
    );
  }
  return result;
}

export async function getDefaultMonthlyCostCapUsd(): Promise<number> {
  try {
    if (usesHostedAppStore()) {
      const row = await hostedInstanceConfig().get();
      const v = row?.defaultMonthlyCostCapUsd;
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v;
      return DEFAULT_MONTHLY_COST_CAP_USD;
    }
    const row = await db.instanceConfig.findUnique({
      where: { id: "singleton" },
      select: { defaultMonthlyCostCapUsd: true },
    });
    const v = row?.defaultMonthlyCostCapUsd;
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v;
  } catch {
    /* schema mid-migrate */
  }
  return DEFAULT_MONTHLY_COST_CAP_USD;
}

/**
 * Resolve the effective monthly cap for a user.
 * Missing profile → default for Cognito users; local owner → unlimited until set.
 */
export async function resolveUserMonthlyCostCapUsd(userId: string): Promise<number | null> {
  try {
    if (usesHostedAppStore()) {
      const row = await hostedAppStore().getProfile(userId);
      if (row) return row.monthlyCostCapUsd;
    } else {
      const profile = await db.userProfile.findUnique({
        where: { userId },
        select: { monthlyCostCapUsd: true },
      });
      if (profile) {
        return profile.monthlyCostCapUsd;
      }
    }
  } catch (err) {
    console.warn(
      "[cost-cap] profile cap unavailable",
      err instanceof Error ? err.message : err,
    );
  }
  if (userId === LOCAL_USER_ID) return null;
  return getDefaultMonthlyCostCapUsd();
}

export async function getUserCostCapStatus(
  userId: string,
  now = new Date(),
): Promise<CostCapStatus> {
  const { resetsAt } = utcMonthBounds(now);
  const [capUsd, spentUsd] = await Promise.all([
    resolveUserMonthlyCostCapUsd(userId),
    getUserMonthSpendUsd(userId, now),
  ]);
  const capped = capUsd != null && spentUsd >= capUsd;
  return {
    capped,
    spentUsd,
    capUsd,
    resetsAt: resetsAt.toISOString(),
    warningLevel: costCapWarningLevel(capUsd, spentUsd),
  };
}
