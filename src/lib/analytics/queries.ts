import { db } from "@/lib/db";
import {
  COST_ESTIMATE_DISCLAIMER,
  DEFAULT_COST_BASELINE_MODEL,
  estimateBaselineCostUsd,
  PRICING_BUNDLE_EFFECTIVE,
  PRICING_BUNDLE_VERSION,
} from "@/lib/pricing";
import { hostedAppStore } from "@/lib/workspaces/hosted-dynamo";
import { findOwnedWorkspace, usesHostedAppStore } from "@/lib/workspaces/store";
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

/** Ensure a workspace filter is owned by the caller; returns null if forbidden. */
export async function resolveWorkspaceScope(
  userId: string,
  workspaceId?: string | null,
): Promise<{ ok: true; workspaceId: string | null } | { ok: false }> {
  if (!workspaceId || workspaceId === "all") {
    return { ok: true, workspaceId: null };
  }
  if (usesHostedAppStore()) {
    const ws = await findOwnedWorkspace(userId, workspaceId);
    if (!ws) return { ok: false };
    return { ok: true, workspaceId: ws.id };
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

type SecurityRow = {
  id: string;
  at: Date;
  workspaceId: string | null;
  source: string;
  category: string;
  riskLevel: string;
  outcome: string;
  count: number;
  sensitivity: string | null;
  resourceKind: string | null;
  resourceId: string | null;
};

type InferenceRow = {
  id?: string;
  at: Date;
  workspaceId: string | null;
  provider?: string;
  model: string;
  tier?: string;
  promptTokens: number | null;
  completionTokens: number | null;
  latencyMs?: number | null;
  status?: string;
  retrievalHitCount?: number;
  citationCount?: number;
  groundingStatus: string | null;
  estimatedCostUsd?: number | null;
  pricingVersion?: string | null;
};

async function workspaceNameMap(userId: string): Promise<Map<string, string>> {
  if (usesHostedAppStore()) {
    const rows = await hostedAppStore().peekWorkspaces(userId);
    return new Map(rows.map(w => [w.id, w.name]));
  }
  const workspaces = await db.workspace.findMany({
    where: { userId },
    select: { id: true, name: true },
  });
  return new Map(workspaces.map(w => [w.id, w.name]));
}

async function documentNameMap(userId: string, ids: string[]): Promise<Map<string, string>> {
  const docNameById = new Map<string, string>();
  if (ids.length === 0) return docNameById;
  if (usesHostedAppStore()) {
    const docs = await hostedAppStore().listDocuments(userId);
    for (const d of docs) {
      if (ids.includes(d.id)) docNameById.set(d.id, d.name);
    }
    return docNameById;
  }
  const docs = await db.document.findMany({
    where: { userId, id: { in: ids } },
    select: { id: true, name: true },
  });
  for (const d of docs) docNameById.set(d.id, d.name);
  return docNameById;
}

async function loadSecurityRows(filter: AnalyticsFilter): Promise<SecurityRow[]> {
  if (usesHostedAppStore()) {
    const from = atFilter(filter.range)?.gte;
    const rows = await hostedAppStore().listSecurityEvents(filter.userId, {
      workspaceId: filter.workspaceId,
      fromIso: from ? from.toISOString() : null,
      take: 2000,
    });
    return rows.map(r => ({ ...r, at: new Date(r.at) }));
  }
  return db.securityEvent.findMany({
    where: securityWhere(filter),
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
}

async function loadInferenceRows(filter: AnalyticsFilter, take: number): Promise<InferenceRow[]> {
  if (usesHostedAppStore()) {
    const from = atFilter(filter.range)?.gte;
    const rows = await hostedAppStore().listInferenceEvents(filter.userId, {
      workspaceId: filter.workspaceId,
      fromIso: from ? from.toISOString() : null,
      take,
    });
    return rows.map(r => ({ ...r, at: new Date(r.at) }));
  }
  return db.inferenceEvent.findMany({
    where: inferenceWhere(filter),
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
      pricingVersion: true,
    },
    orderBy: { at: "desc" },
    take,
  });
}

export async function getSecuritySummary(filter: AnalyticsFilter) {
  const events = await loadSecurityRows(filter);

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

  const nameById = await workspaceNameMap(filter.userId);

  // Resolve Knowledge document names for events that already store resourceId.
  const documentIds = [
    ...new Set(
      events
        .filter(e => e.resourceKind === "document" && e.resourceId)
        .map(e => e.resourceId as string),
    ),
  ];
  const docNameById = await documentNameMap(filter.userId, documentIds);

  const byDocument = new Map<string, { documentId: string; name: string; count: number }>();
  for (const e of events) {
    if (e.resourceKind !== "document" || !e.resourceId) continue;
    const name = docNameById.get(e.resourceId) ?? "Deleted or unavailable document";
    const row = byDocument.get(e.resourceId) ?? {
      documentId: e.resourceId,
      name,
      count: 0,
    };
    row.count += e.count;
    byDocument.set(e.resourceId, row);
  }

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
    byDocument: [...byDocument.values()].sort((a, b) => b.count - a.count),
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
    events: events.slice(0, 200).map(e => ({
      ...e,
      resourceName:
        e.resourceKind === "document" && e.resourceId
          ? (docNameById.get(e.resourceId) ?? "Deleted or unavailable document")
          : e.resourceKind === "message"
            ? "Chat message"
            : null,
    })),
  };
}

export async function getUsageSummary(filter: AnalyticsFilter) {
  const events = await loadInferenceRows(filter, 5000);

  const total = events.length;
  const ok = events.filter(e => (e.status ?? "ok") === "ok").length;
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
  const retrievalHits = events.filter(e => (e.retrievalHitCount ?? 0) > 0).length;
  const withCitations = events.filter(e => (e.citationCount ?? 0) > 0).length;

  const byModel = new Map<string, number>();
  const byTier = new Map<string, number>();
  const byGrounding = new Map<string, number>();
  const byDay = new Map<string, { requests: number; prompt: number; completion: number }>();
  const byWorkspace = new Map<string, { requests: number; prompt: number; completion: number }>();

  let topModel: string | null = null;
  let topModelCount = 0;

  for (const e of events) {
    byModel.set(e.model, (byModel.get(e.model) ?? 0) + 1);
    const tier = e.tier ?? "Standard";
    byTier.set(tier, (byTier.get(tier) ?? 0) + 1);
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

  const nameById = await workspaceNameMap(filter.userId);

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
  const events = await loadInferenceRows(filter, 5000);

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

  const nameById = await workspaceNameMap(filter.userId);

  const routingSavings = Math.max(0, baselineCost - totalCost);
  const avgCost = pricedRequests > 0 ? totalCost / pricedRequests : null;

  // Rough projection: average daily cost × 30 when we have at least 2 days
  const dayCosts = [...byDay.values()];
  const projectedMonthly =
    dayCosts.length >= 2
      ? (dayCosts.reduce((a, b) => a + b, 0) / dayCosts.length) * 30
      : null;

  return {
    disclaimer: COST_ESTIMATE_DISCLAIMER,
    pricing: {
      version: PRICING_BUNDLE_VERSION,
      effective: PRICING_BUNDLE_EFFECTIVE,
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
        `Savings estimate = cost if every request used ${DEFAULT_COST_BASELINE_MODEL} minus actual routed model cost (list rates ${PRICING_BUNDLE_VERSION}). Not an AWS bill or invoice.`,
    },
  };
}
