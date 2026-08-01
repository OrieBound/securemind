"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import type { AnalyticsRange } from "@/lib/analytics/types";

export type AnalyticsTab = "security" | "usage" | "cost";

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
};

const TABS: { id: AnalyticsTab; href: string; label: string }[] = [
  { id: "security", href: "/analytics/security", label: "Security" },
  { id: "usage", href: "/analytics/usage", label: "Usage" },
  { id: "cost", href: "/analytics/cost", label: "Cost" },
];

const RANGE_OPTS: { id: AnalyticsRange; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "all", label: "All time" },
];

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
}: Props) {
  const workspaceLabel = useMemo(() => {
    if (workspaceId === "all") return "All workspaces";
    return workspaces.find(w => w.id === workspaceId)?.name ?? "Workspace";
  }, [workspaceId, workspaces]);

  const rangeLabel = RANGE_OPTS.find(r => r.id === range)?.label ?? range;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-white/10 px-4 sm:px-6 py-4">
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs text-white/70 hover:text-white hover:bg-white/[0.07]"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            Investigate
          </Link>
          <nav
            className="inline-flex rounded-lg border border-white/10 bg-black/20 p-0.5"
            aria-label="Analytics views"
          >
            {TABS.map(tab => (
              <Link
                key={tab.id}
                href={tab.href}
                className={
                  tab.id === active
                    ? "rounded-md bg-white/10 px-3 py-1.5 text-xs font-medium text-white"
                    : "rounded-md px-3 py-1.5 text-xs text-white/50 hover:text-white/80"
                }
                aria-current={tab.id === active ? "page" : undefined}
              >
                {tab.label}
              </Link>
            ))}
          </nav>
        </div>

        <h1 className="text-xl font-semibold text-white/90 tracking-tight">{title}</h1>
        <p className="text-sm text-white/45 mt-1 max-w-3xl">{subtitle}</p>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="text-xs text-white/45">
            Date range
            <select
              value={range}
              onChange={e => onRangeChange(e.target.value as AnalyticsRange)}
              className="mt-1 block rounded-md border border-white/10 bg-black/30 px-2.5 py-1.5 text-sm text-white/85"
            >
              {RANGE_OPTS.map(o => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-white/45">
            Workspace
            <select
              value={workspaceId}
              onChange={e => onWorkspaceChange(e.target.value)}
              className="mt-1 block min-w-[12rem] rounded-md border border-white/10 bg-black/30 px-2.5 py-1.5 text-sm text-white/85"
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
          <p className="text-[0.65rem] text-white/30 ml-auto self-center">
            Scope: {rangeLabel} · {workspaceLabel}
          </p>
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
