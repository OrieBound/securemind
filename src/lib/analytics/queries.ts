import { db } from "@/lib/db";
import {
  DEFAULT_COST_BASELINE_MODEL,
  estimateBaselineCostUsd,
  GROQ_PRICING_EFFECTIVE,
  GROQ_PRICING_VERSION,
} from "@/lib/pricing/groq";
import { resolveDateRange, type AnalyticsRange } from "./types";

export type AnalyticsFilter = {
  userId: string;
  range: AnalyticsRange;
  workspaceId?: string | null; // null/undefined = all owned workspaces
};

function atFilter(range: AnalyticsRange) {
  const { from } = resolveDateRange(range);
  return from ? { gte: from } : undefined;
}

async function ownedWorkspaceIds(userId: string): Promise<string[]> {
  const rows = await db.workspace.findMany({
    where: { userId },
    select: { id: true },
  });
  return rows.map(r => r.id);
}

/** Ensure a workspace filter is owned by the caller; returns null if forbidden. */
export async function resolveWorkspaceScope(
  userId: string,
  workspaceId?: string | null,
): Promise<{ ok: true; workspaceId: string | null } | { ok: false }> {
  if (!workspaceId || workspaceId === "all") {
    return { ok: true, workspaceId: null };
  }
  const ws = await db.workspace.findFirst({
    where: { id: workspaceId, userId },
    select: { id: true },
  });
  if (!ws) return { ok: false };
  return { ok: true, workspaceId: ws.id };
}

function securityWhere(filter: AnalyticsFilter) {
  const at = atFilter(filter.range);
  return {
    userId: filter.userId,
    ...(filter.workspaceId ? { workspaceId: filter.workspaceId } : {}),
    ...(at ? { at } : {}),
  };
}

function inferenceWhere(filter: AnalyticsFilter) {
  const at = atFilter(filter.range);
  return {
    userId: filter.userId,
    ...(filter.workspaceId ? { workspaceId: filter.workspaceId } : {}),
    ...(at ? { at } : {}),
  };
}

export async function getSecuritySummary(filter: AnalyticsFilter) {
  const where = securityWhere(filter);
  const events = await db.securityEvent.findMany({
    where,
    select: {
      id: true,
      at: true,
      workspaceId: true,
      source: true,
      category: true,
      riskLevel: true,
      outcome: true,
      count: true,
      sensitivity: true,
      resourceKind: true,
      resourceId: true,
    },
    orderBy: { at: "desc" },
    take: 2000,
  });

  const totalFindings = events.reduce((s, e) => s + e.count, 0);
  const highRiskBlocked = events
    .filter(e => e.outcome === "blocked" && (e.riskLevel === "high" || e.riskLevel === "critical"))
    .reduce((s, e) => s + e.count, 0);
  const itemsRedacted = events
    .filter(e => e.outcome === "redacted")
    .reduce((s, e) => s + e.count, 0);
  const dismissedOrSafe = events
    .filter(e => e.outcome === "dismissed" || e.outcome === "safe_listed")
    .reduce((s, e) => s + e.count, 0);

  const byCategory = new Map<string, number>();
  const byOutcome = new Map<string, number>();
  const bySource = new Map<string, number>();
  const byWorkspace = new Map<string, number>();
  const byDay = new Map<string, Map<string, number>>();

  for (const e of events) {
    byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + e.count);
    byOutcome.set(e.outcome, (byOutcome.get(e.outcome) ?? 0) + e.count);
    bySource.set(e.source, (bySource.get(e.source) ?? 0) + e.count);
    const ws = e.workspaceId ?? "unassigned";
    byWorkspace.set(ws, (byWorkspace.get(ws) ?? 0) + e.count);
    const day = e.at.toISOString().slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, new Map());
    const dayMap = byDay.get(day)!;
    dayMap.set(e.category, (dayMap.get(e.category) ?? 0) + e.count);
  }

  let topCategory: string | null = null;
  let topCategoryCount = 0;
  for (const [cat, n] of byCategory) {
    if (n > topCategoryCount) {
      topCategory = cat;
      topCategoryCount = n;
    }
  }

  const workspaces = await db.workspace.findMany({
    where: { userId: filter.userId },
    select: { id: true, name: true },
  });
  const nameById = new Map(workspaces.map(w => [w.id, w.name]));

  return {
    kpis: {
      totalFindings,
      highRiskBlocked,
      itemsRedacted,
      eventsLogged: events.length,
      dismissedOrSafeListed: dismissedOrSafe,
      activeCategories: byCategory.size,
      topCategory,
    },
    byCategory: [...byCategory.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count),
    byOutcome: [...byOutcome.entries()].map(([outcome, count]) => ({ outcome, count })),
    bySource: [...bySource.entries()].map(([source, count]) => ({ source, count })),
    byWorkspace: [...byWorkspace.entries()].map(([workspaceId, count]) => ({
      workspaceId,
      name: nameById.get(workspaceId) ?? workspaceId,
      count,
    })),
    overTime: [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, cats]) => ({
        date,
        ...Object.fromEntries(cats),
      })),
    events: events.slice(0, 200),
  };
}

export async function getUsageSummary(filter: AnalyticsFilter) {
  const where = inferenceWhere(filter);
  const events = await db.inferenceEvent.findMany({
    where,
    select: {
      id: true,
      at: true,
      workspaceId: true,
      provider: true,
      model: true,
      tier: true,
      promptTokens: true,
      completionTokens: true,
      latencyMs: true,
      status: true,
      retrievalHitCount: true,
      citationCount: true,
      groundingStatus: true,
      estimatedCostUsd: true,
    },
    orderBy: { at: "desc" },
    take: 5000,
  });

  const total = events.length;
  const ok = events.filter(e => e.status === "ok").length;
  const promptTokens = events.reduce((s, e) => s + (e.promptTokens ?? 0), 0);
  const completionTokens = events.reduce((s, e) => s + (e.completionTokens ?? 0), 0);
  const latencies = events.map(e => e.latencyMs).filter((n): n is number => n != null);
  const avgLatencyMs =
    latencies.length > 0
      ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
      : null;
  const grounded = events.filter(e => e.groundingStatus === "grounded").length;
  const withGrounding = events.filter(
    e =>
      e.groundingStatus &&
      e.groundingStatus !== "n/a" &&
      e.groundingStatus !== "not_applicable",
  ).length;
  const retrievalHits = events.filter(e => e.retrievalHitCount > 0).length;
  const withCitations = events.filter(e => e.citationCount > 0).length;

  const byModel = new Map<string, number>();
  const byTier = new Map<string, number>();
  const byGrounding = new Map<string, number>();
  const byDay = new Map<string, { requests: number; prompt: number; completion: number }>();
  const byWorkspace = new Map<string, { requests: number; prompt: number; completion: number }>();

  let topModel: string | null = null;
  let topModelCount = 0;

  for (const e of events) {
    byModel.set(e.model, (byModel.get(e.model) ?? 0) + 1);
    byTier.set(e.tier, (byTier.get(e.tier) ?? 0) + 1);
    const g = e.groundingStatus ?? "not_applicable";
    byGrounding.set(g, (byGrounding.get(g) ?? 0) + 1);
    const day = e.at.toISOString().slice(0, 10);
    const dayRow = byDay.get(day) ?? { requests: 0, prompt: 0, completion: 0 };
    dayRow.requests += 1;
    dayRow.prompt += e.promptTokens ?? 0;
    dayRow.completion += e.completionTokens ?? 0;
    byDay.set(day, dayRow);
    const ws = e.workspaceId ?? "unassigned";
    const wsRow = byWorkspace.get(ws) ?? { requests: 0, prompt: 0, completion: 0 };
    wsRow.requests += 1;
    wsRow.prompt += e.promptTokens ?? 0;
    wsRow.completion += e.completionTokens ?? 0;
    byWorkspace.set(ws, wsRow);
  }
  for (const [model, n] of byModel) {
    if (n > topModelCount) {
      topModel = model;
      topModelCount = n;
    }
  }

  const workspaces = await db.workspace.findMany({
    where: { userId: filter.userId },
    select: { id: true, name: true },
  });
  const nameById = new Map(workspaces.map(w => [w.id, w.name]));

  return {
    kpis: {
      totalRequests: total,
      promptTokens,
      completionTokens,
      avgLatencyMs,
      successRate: total > 0 ? ok / total : null,
      groundedRate: withGrounding > 0 ? grounded / withGrounding : null,
      retrievalHitRate: total > 0 ? retrievalHits / total : null,
      citationUsageRate: total > 0 ? withCitations / total : null,
      topModel,
    },
    overTime: [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date, ...v })),
    byModel: [...byModel.entries()]
      .map(([model, count]) => ({ model, count }))
      .sort((a, b) => b.count - a.count),
    byTier: [...byTier.entries()].map(([tier, count]) => ({ tier, count })),
    byGrounding: [...byGrounding.entries()].map(([status, count]) => ({ status, count })),
    byWorkspace: [...byWorkspace.entries()].map(([workspaceId, v]) => ({
      workspaceId,
      name: nameById.get(workspaceId) ?? workspaceId,
      ...v,
    })),
    latencySamples: latencies.slice(0, 500),
  };
}

export async function getCostSummary(filter: AnalyticsFilter) {
  const where = inferenceWhere(filter);
  const events = await db.inferenceEvent.findMany({
    where,
    select: {
      at: true,
      workspaceId: true,
      provider: true,
      model: true,
      promptTokens: true,
      completionTokens: true,
      estimatedCostUsd: true,
      pricingVersion: true,
    },
    orderBy: { at: "desc" },
    take: 5000,
  });

  let totalCost = 0;
  let inputCost = 0;
  let outputCost = 0;
  let baselineCost = 0;
  let pricedRequests = 0;

  const byDay = new Map<string, number>();
  const byModel = new Map<string, number>();
  const byWorkspace = new Map<string, number>();

  for (const e of events) {
    const cost = e.estimatedCostUsd;
    if (cost == null) continue;
    pricedRequests += 1;
    totalCost += cost;
    const p = e.promptTokens ?? 0;
    const c = e.completionTokens ?? 0;
    // Split using same list rates when available via estimate helpers
    const base = estimateBaselineCostUsd(p, c, DEFAULT_COST_BASELINE_MODEL);
    if (base != null) baselineCost += base;

    // Approximate input/output split from total when we have tokens
    const denom = p + c;
    if (denom > 0) {
      inputCost += cost * (p / denom);
      outputCost += cost * (c / denom);
    }

    const day = e.at.toISOString().slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + cost);
    byModel.set(e.model, (byModel.get(e.model) ?? 0) + cost);
    const ws = e.workspaceId ?? "unassigned";
    byWorkspace.set(ws, (byWorkspace.get(ws) ?? 0) + cost);
  }

  const workspaces = await db.workspace.findMany({
    where: { userId: filter.userId },
    select: { id: true, name: true },
  });
  const nameById = new Map(workspaces.map(w => [w.id, w.name]));

  const routingSavings = Math.max(0, baselineCost - totalCost);
  const avgCost = pricedRequests > 0 ? totalCost / pricedRequests : null;

  // Rough projection: average daily cost × 30 when we have at least 2 days
  const dayCosts = [...byDay.values()];
  const projectedMonthly =
    dayCosts.length >= 2
      ? (dayCosts.reduce((a, b) => a + b, 0) / dayCosts.length) * 30
      : null;

  return {
    disclaimer:
      "Estimated AI inference cost from recorded Groq list pricing. Does not include AWS, infrastructure, or organizational spend.",
    pricing: {
      version: GROQ_PRICING_VERSION,
      effective: GROQ_PRICING_EFFECTIVE,
      baselineModel: DEFAULT_COST_BASELINE_MODEL,
    },
    kpis: {
      estimatedCostUsd: totalCost,
      avgCostPerRequest: avgCost,
      inputTokenCostUsd: inputCost,
      outputTokenCostUsd: outputCost,
      routingSavingsUsd: routingSavings,
      projectedMonthlyUsd: projectedMonthly,
      pricedRequests,
      unpricedRequests: events.length - pricedRequests,
    },
    overTime: [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, costUsd]) => ({ date, costUsd })),
    byModel: [...byModel.entries()]
      .map(([model, costUsd]) => ({ model, costUsd }))
      .sort((a, b) => b.costUsd - a.costUsd),
    byWorkspace: [...byWorkspace.entries()].map(([workspaceId, costUsd]) => ({
      workspaceId,
      name: nameById.get(workspaceId) ?? workspaceId,
      costUsd,
    })),
    vsBaseline: {
      actualUsd: totalCost,
      baselineUsd: baselineCost,
      savingsUsd: routingSavings,
      explanation:
        `Savings estimate = cost if every request used ${DEFAULT_COST_BASELINE_MODEL} minus actual routed model cost (Groq list pricing ${GROQ_PRICING_VERSION}). Not AWS savings.`,
    },
  };
}

export async function getEvidenceRailSummaries(filter: AnalyticsFilter) {
  const [security, usage, cost] = await Promise.all([
    getSecuritySummary(filter),
    getUsageSummary(filter),
    getCostSummary(filter),
  ]);
  return {
    security: {
      findings: security.kpis.totalFindings,
      highRiskBlocked: security.kpis.highRiskBlocked,
      topCategory: security.kpis.topCategory,
    },
    usage: {
      requests: usage.kpis.totalRequests,
      tokens: usage.kpis.promptTokens + usage.kpis.completionTokens,
      groundedRate: usage.kpis.groundedRate,
      topModel: usage.kpis.topModel,
    },
    cost: {
      estimatedCostUsd: cost.kpis.estimatedCostUsd,
      avgCostPerRequest: cost.kpis.avgCostPerRequest,
      routingSavingsUsd: cost.kpis.routingSavingsUsd,
    },
  };
}

export async function ensureWorkspaceOwned(userId: string, workspaceId: string | null | undefined) {
  if (!workspaceId) return true;
  const ids = await ownedWorkspaceIds(userId);
  return ids.includes(workspaceId);
}
