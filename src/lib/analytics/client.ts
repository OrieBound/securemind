/** Browser helpers for analytics — never send raw detected values. */

import { formatUsd } from "@/lib/cost-cap-shared";
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
  path: "security" | "usage" | "cost",
  opts: {
    range: AnalyticsRange;
    workspaceId?: string | null;
    /** Admin-only subject override — ignored by the API for non-admins. */
    asUser?: string | null;
  },
  signal?: AbortSignal,
): Promise<T> {
  const params = new URLSearchParams({ range: opts.range });
  if (opts.workspaceId && opts.workspaceId !== "all") {
    params.set("workspaceId", opts.workspaceId);
  }
  if (opts.asUser) {
    params.set("asUser", opts.asUser);
  }
  const res = await fetch(`/api/analytics/${path}?${params}`, {
    credentials: "same-origin",
    signal,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `Failed to load ${path}`);
  }
  return res.json() as Promise<T>;
}

export function fmtUsd(d: number | null | undefined): string {
  if (d == null || Number.isNaN(d)) return "—";
  return formatUsd(d);
}

/** Always labels currency as USD (caps / Insights meters). */
export function fmtUsdLabeled(d: number | null | undefined): string {
  if (d == null || Number.isNaN(d)) return "Unlimited";
  return `${fmtUsd(d)} USD`;
}

export function fmtPct(rate: number | null | undefined): string {
  if (rate == null || Number.isNaN(rate)) return "—";
  return `${Math.round(rate * 100)}%`;
}

export function shortModel(id: string | null | undefined): string {
  if (!id) return "—";
  return id.split("/").pop() ?? id;
}
