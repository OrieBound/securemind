/**
 * Cross-user aggregates for the Admin console.
 * Caller must already have passed requireAdmin — this module does not authz.
 *
 * Uses groupBy / aggregate so the console does not load every workspace,
 * document, or telemetry row into Node.
 */

import { db } from "@/lib/db";
import { resolveDateRange, type AnalyticsRange } from "@/lib/analytics/types";

export type OrgOverview = {
  range: AnalyticsRange;
  usersWithActivity: number;
  workspaceCount: number;
  documentCount: number;
  inferenceRequests: number;
  promptTokens: number;
  completionTokens: number;
  estimatedCostUsd: number;
  securityEvents: number;
  highRiskBlocked: number;
  byUser: Array<{
    userId: string;
    workspaces: number;
    documents: number;
    inferenceRequests: number;
    estimatedCostUsd: number;
    securityEvents: number;
  }>;
};

function atFilter(range: AnalyticsRange) {
  const { from } = resolveDateRange(range);
  return from ? { gte: from } : undefined;
}

type Acc = {
  workspaces: number;
  documents: number;
  inferenceRequests: number;
  estimatedCostUsd: number;
  securityEvents: number;
};

function accOf(map: Map<string, Acc>, userId: string): Acc {
  let row = map.get(userId);
  if (!row) {
    row = {
      workspaces: 0,
      documents: 0,
      inferenceRequests: 0,
      estimatedCostUsd: 0,
      securityEvents: 0,
    };
    map.set(userId, row);
  }
  return row;
}

export async function getOrgOverview(range: AnalyticsRange = "30d"): Promise<OrgOverview> {
  const at = atFilter(range);
  const timed = at ? { at } : {};

  const [wsGroups, docGroups, infGroups, secGroups, blocked] = await Promise.all([
    db.workspace.groupBy({
      by: ["userId"],
      _count: { _all: true },
    }),
    db.document.groupBy({
      by: ["userId"],
      _count: { _all: true },
    }),
    db.inferenceEvent.groupBy({
      by: ["userId"],
      where: timed,
      _count: { _all: true },
      _sum: {
        promptTokens: true,
        completionTokens: true,
        estimatedCostUsd: true,
      },
    }),
    db.securityEvent.groupBy({
      by: ["userId"],
      where: timed,
      _sum: { count: true },
    }),
    db.securityEvent.aggregate({
      where: {
        ...timed,
        outcome: "blocked",
        riskLevel: { in: ["high", "critical"] },
      },
      _sum: { count: true },
    }),
  ]);

  const byUserMap = new Map<string, Acc>();

  let workspaceCount = 0;
  for (const g of wsGroups) {
    workspaceCount += g._count._all;
    accOf(byUserMap, g.userId).workspaces = g._count._all;
  }

  let documentCount = 0;
  for (const g of docGroups) {
    documentCount += g._count._all;
    accOf(byUserMap, g.userId).documents = g._count._all;
  }

  let inferenceRequests = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let estimatedCostUsd = 0;
  for (const g of infGroups) {
    const n = g._count._all;
    inferenceRequests += n;
    promptTokens += g._sum.promptTokens ?? 0;
    completionTokens += g._sum.completionTokens ?? 0;
    estimatedCostUsd += g._sum.estimatedCostUsd ?? 0;
    const row = accOf(byUserMap, g.userId);
    row.inferenceRequests = n;
    row.estimatedCostUsd = g._sum.estimatedCostUsd ?? 0;
  }

  let securityEvents = 0;
  for (const g of secGroups) {
    const n = g._sum.count ?? 0;
    securityEvents += n;
    accOf(byUserMap, g.userId).securityEvents = n;
  }

  const byUser = [...byUserMap.entries()]
    .map(([userId, v]) => ({ userId, ...v }))
    .sort((a, b) => b.inferenceRequests - a.inferenceRequests || b.securityEvents - a.securityEvents);

  return {
    range,
    usersWithActivity: byUserMap.size,
    workspaceCount,
    documentCount,
    inferenceRequests,
    promptTokens,
    completionTokens,
    estimatedCostUsd,
    securityEvents,
    highRiskBlocked: blocked._sum.count ?? 0,
    byUser,
  };
}
