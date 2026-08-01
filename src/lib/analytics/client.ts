/** Browser helpers for analytics — never send raw detected values. */

import type { AnalyticsRange, SecurityOutcome, SecuritySource } from "./types";

export type SecurityEventPayload = {
  category: string;
  source: SecuritySource;
  outcome: SecurityOutcome;
  count?: number;
  resourceKind?: "message" | "document";
  resourceId?: string;
};

export async function postSecurityEvents(opts: {
  workspaceId?: string | null;
  sensitivity?: string | null;
  events: SecurityEventPayload[];
}): Promise<void> {
  if (opts.events.length === 0) return;
  try {
    await fetch("/api/analytics/security", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId: opts.workspaceId ?? undefined,
        sensitivity: opts.sensitivity ?? undefined,
        events: opts.events.map(e => ({
          category: e.category,
          source: e.source,
          outcome: e.outcome,
          count: e.count ?? 1,
          resourceKind: e.resourceKind,
          resourceId: e.resourceId,
        })),
      }),
    });
  } catch {
    /* non-critical */
  }
}

export async function fetchAnalyticsJson<T>(
  path: "security" | "usage" | "cost" | "summary",
  opts: { range: AnalyticsRange; workspaceId?: string | null },
): Promise<T> {
  const params = new URLSearchParams({ range: opts.range });
  if (opts.workspaceId && opts.workspaceId !== "all") {
    params.set("workspaceId", opts.workspaceId);
  }
  const res = await fetch(`/api/analytics/${path}?${params}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `Failed to load ${path}`);
  }
  return res.json() as Promise<T>;
}

export function fmtUsd(d: number | null | undefined): string {
  if (d == null || Number.isNaN(d)) return "—";
  if (d === 0) return "$0.00";
  if (d < 0.0001) return "<$0.0001";
  if (d < 0.01) return `$${d.toFixed(4)}`;
  return `$${d.toFixed(2)}`;
}

export function fmtPct(rate: number | null | undefined): string {
  if (rate == null || Number.isNaN(rate)) return "—";
  return `${Math.round(rate * 100)}%`;
}

export function shortModel(id: string | null | undefined): string {
  if (!id) return "—";
  return id.split("/").pop() ?? id;
}
