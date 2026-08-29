"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, Shield } from "lucide-react";
import type { AnalyticsRange } from "@/lib/analytics/types";

export type AnalyticsTab = "security" | "usage" | "cost";

export type InsightsSubjectScope = {
  userId: string;
  label: string;
  email: string | null;
};

type WorkspaceOpt = { id: string; name: string };

type Props = {
  active: AnalyticsTab;
  title: string;
  subtitle: string;
  workspaces: WorkspaceOpt[];
  range: AnalyticsRange;
  workspaceId: string;
  onRangeChange: (r: AnalyticsRange) => void;
  onWorkspaceChange: (id: string) => void;
  extraFilters?: ReactNode;
  children: ReactNode;
  /** Admin observing another member's Insights. */
  subject?: InsightsSubjectScope | null;
  onBackToAdmin?: () => void;
};

const TABS: { id: AnalyticsTab; path: string; label: string }[] = [
  { id: "usage", path: "/analytics/usage", label: "Usage" },
  { id: "cost", path: "/analytics/cost", label: "Cost" },
  { id: "security", path: "/analytics/security", label: "Security" },
];

const RANGE_OPTS: { id: AnalyticsRange; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "all", label: "All time" },
];

function tabHref(path: string, subject?: InsightsSubjectScope | null) {
  if (!subject?.userId) return path;
  const params = new URLSearchParams({ asUser: subject.userId });
  if (subject.label) params.set("label", subject.label);
  return `${path}?${params.toString()}`;
}

export function AnalyticsShell({
  active,
  title,
  subtitle,
  workspaces,
  range,
  workspaceId,
  onRangeChange,
  onWorkspaceChange,
  extraFilters,
  children,
  subject = null,
  onBackToAdmin,
}: Props) {
  const workspaceLabel = useMemo(() => {
    if (workspaceId === "all") return "All workspaces";
    return workspaces.find(w => w.id === workspaceId)?.name ?? "Workspace";
  }, [workspaceId, workspaces]);

  const rangeLabel = RANGE_OPTS.find(r => r.id === range)?.label ?? range;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-foreground/10">
        {/* Admin subject identity — first thing you see when drilling down */}
        {subject && (
          <div className="border-b border-[var(--warning-border)] bg-[var(--warning-soft)] px-4 sm:px-6 py-3.5">
            {onBackToAdmin && (
              <button
                type="button"
                onClick={onBackToAdmin}
                className="mb-2.5 inline-flex items-center gap-1.5 rounded-lg border border-[var(--warning-border)] bg-card px-3 py-2 text-xs font-semibold text-[var(--warning)] hover:bg-[var(--surface-hover)] cursor-pointer"
              >
                <ArrowLeft className="size-3.5" aria-hidden />
                Back to Admin
              </button>
            )}
            <div className="min-w-0">
              <p className="text-[0.58rem] uppercase tracking-[0.18em] font-semibold text-[var(--warning)] flex items-center gap-1.5">
                <Shield className="size-3 shrink-0" aria-hidden />
                Admin viewing member
              </p>
              <p className="mt-1 text-lg sm:text-xl font-semibold text-foreground tracking-tight truncate">
                {subject.label}
              </p>
              <p className="mt-0.5 text-[0.7rem] text-[var(--text-secondary)] font-mono truncate">
                {subject.email && subject.email !== subject.label
                  ? subject.email
                  : subject.userId}
                <span className="text-[var(--text-muted)]"> · not your account</span>
              </p>
            </div>
            <p className="mt-2 text-[0.62rem] text-[var(--text-secondary)] leading-relaxed max-w-2xl">
              Read-only org view of this member&apos;s Usage, Cost, and Security. Workspace names
              in the sidebar (e.g. your own) are unrelated to whose metrics are shown here.
            </p>
          </div>
        )}

        <div className="px-4 sm:px-6 py-4">
          <div className="flex flex-wrap items-center gap-3 mb-3">
            {!subject && (
              <Link
                href="/"
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs text-secondary-foreground hover:bg-[var(--surface-hover)] hover:text-foreground"
              >
                <ArrowLeft className="size-3.5" aria-hidden />
                Chat
              </Link>
            )}
            <nav
              className="inline-flex rounded-xl border border-border bg-muted p-1"
              aria-label="Analytics views"
            >
              {TABS.map(tab => (
                <Link
                  key={tab.id}
                  href={tabHref(tab.path, subject)}
                  className={
                    tab.id === active
                      ? "rounded-lg bg-card px-4 py-2 text-sm font-semibold text-[var(--primary-soft-foreground)] shadow-[var(--shadow-sm)] ring-1 ring-[var(--primary-border)]"
                      : "rounded-lg px-4 py-2 text-sm text-muted-foreground hover:bg-[var(--surface-hover)] hover:text-foreground"
                  }
                  aria-current={tab.id === active ? "page" : undefined}
                >
                  {tab.label}
                </Link>
              ))}
            </nav>
          </div>

          <h1 className="text-xl font-semibold text-foreground tracking-tight">
            {subject ? `${title} · ${subject.label}` : title}
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-3xl">{subtitle}</p>

          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="text-xs text-muted-foreground">
              Date range
              <select
                value={range}
                onChange={e => onRangeChange(e.target.value as AnalyticsRange)}
                className="mt-1 block rounded-md border border-border bg-card px-2.5 py-1.5 text-sm text-foreground shadow-[var(--shadow-sm)]"
              >
                {RANGE_OPTS.map(o => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs text-muted-foreground">
              Workspace
              <select
                value={workspaceId}
                onChange={e => onWorkspaceChange(e.target.value)}
                className="mt-1 block min-w-[12rem] rounded-md border border-border bg-card px-2.5 py-1.5 text-sm text-foreground shadow-[var(--shadow-sm)]"
              >
                <option value="all">All workspaces</option>
                {workspaces.map(w => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
            {extraFilters}
            <p className="text-[0.65rem] text-[var(--text-subtle)] ml-auto self-center">
              Scope: {rangeLabel} · {workspaceLabel}
              {subject ? ` · ${subject.label}` : ""}
            </p>
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 sm:px-6 py-5 space-y-5 max-w-[1600px] w-full mx-auto">
        {children}
      </div>
    </div>
  );
}

export function useAnalyticsFilters(defaultRange: AnalyticsRange = "30d") {
  const [range, setRange] = useState<AnalyticsRange>(defaultRange);
  const [workspaceId, setWorkspaceId] = useState("all");
  return { range, setRange, workspaceId, setWorkspaceId };
}

export function rangeLabelOf(range: AnalyticsRange): string {
  return RANGE_OPTS.find(r => r.id === range)?.label ?? range;
}
