"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Area,
  AreaChart,
} from "recharts";
import { AnalyticsShell, rangeLabelOf, useAnalyticsFilters } from "./analytics-shell";
import { ChartFrame } from "./chart-frame";
import { KpiCard } from "./kpi-card";
import { fetchAnalyticsJson } from "@/lib/analytics/client";

type WorkspaceOpt = { id: string; name: string };

type SecurityPayload = {
  kpis: {
    totalFindings: number;
    highRiskBlocked: number;
    itemsRedacted: number;
    eventsLogged: number;
    dismissedOrSafeListed: number;
    activeCategories: number;
    topCategory: string | null;
  };
  byCategory: { category: string; count: number }[];
  byOutcome: { outcome: string; count: number }[];
  bySource: { source: string; count: number }[];
  byWorkspace: { workspaceId: string; name: string; count: number }[];
  overTime: Record<string, string | number>[];
  events: {
    id: string;
    at: string;
    category: string;
    riskLevel: string;
    outcome: string;
    source: string;
    count: number;
  }[];
};

const CHART_COLORS = ["#818cf8", "#34d399", "#fbbf24", "#f472b6", "#22d3ee", "#a78bfa"];

type Props = { workspaces: WorkspaceOpt[] };

export function SecurityAnalyticsView({ workspaces }: Props) {
  const { range, setRange, workspaceId, setWorkspaceId } = useAnalyticsFilters("30d");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [riskFilter, setRiskFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [outcomeFilter, setOutcomeFilter] = useState("all");
  const [data, setData] = useState<SecurityPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchAnalyticsJson<SecurityPayload>("security", { range, workspaceId })
      .then(d => {
        if (!cancelled) setData(d);
      })
      .catch(e => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range, workspaceId]);

  const rangeLabel = rangeLabelOf(range);
  const workspaceLabel =
    workspaceId === "all"
      ? "All workspaces"
      : workspaces.find(w => w.id === workspaceId)?.name ?? "Workspace";

  const filteredEvents = useMemo(() => {
    if (!data) return [];
    return data.events.filter(e => {
      if (categoryFilter !== "all" && e.category !== categoryFilter) return false;
      if (riskFilter !== "all" && e.riskLevel !== riskFilter) return false;
      if (sourceFilter !== "all" && e.source !== sourceFilter) return false;
      if (outcomeFilter !== "all" && e.outcome !== outcomeFilter) return false;
      return true;
    });
  }, [data, categoryFilter, riskFilter, sourceFilter, outcomeFilter]);

  const categories = data?.byCategory.map(c => c.category) ?? [];
  const overTimeKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const row of data?.overTime ?? []) {
      for (const k of Object.keys(row)) {
        if (k !== "date") keys.add(k);
      }
    }
    return [...keys];
  }, [data]);

  return (
    <AnalyticsShell
      active="security"
      title="Security"
      subtitle="Sanitized finding metadata only — raw detected values are never stored or charted."
      workspaces={workspaces}
      range={range}
      workspaceId={workspaceId}
      onRangeChange={setRange}
      onWorkspaceChange={setWorkspaceId}
      extraFilters={
        <>
          <FilterSelect label="Category" value={categoryFilter} onChange={setCategoryFilter} options={categories} />
          <FilterSelect
            label="Risk"
            value={riskFilter}
            onChange={setRiskFilter}
            options={["low", "medium", "high", "critical"]}
          />
          <FilterSelect
            label="Source"
            value={sourceFilter}
            onChange={setSourceFilter}
            options={["investigate", "knowledge_document", "image_ocr"]}
          />
          <FilterSelect
            label="Outcome"
            value={outcomeFilter}
            onChange={setOutcomeFilter}
            options={["redacted", "blocked", "safe_listed", "dismissed", "reviewed"]}
          />
        </>
      }
    >
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <KpiCard label="Total findings" value={loading ? "…" : String(data?.kpis.totalFindings ?? 0)} />
        <KpiCard label="High-risk blocked" value={loading ? "…" : String(data?.kpis.highRiskBlocked ?? 0)} />
        <KpiCard label="Items redacted" value={loading ? "…" : String(data?.kpis.itemsRedacted ?? 0)} />
        <KpiCard label="Events logged" value={loading ? "…" : String(data?.kpis.eventsLogged ?? 0)} />
        <KpiCard
          label="Dismissed / safe-listed"
          value={loading ? "…" : String(data?.kpis.dismissedOrSafeListed ?? 0)}
          hint="Only explicit user actions"
        />
        <KpiCard label="Active categories" value={loading ? "…" : String(data?.kpis.activeCategories ?? 0)} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <ChartFrame
          title="Findings over time"
          interpretation="Stacked volume of findings by category across the selected period."
          rangeLabel={rangeLabel}
          workspaceLabel={workspaceLabel}
          loading={loading}
          error={error}
          empty={!loading && (data?.overTime.length ?? 0) === 0}
          tableHeaders={["Date", ...overTimeKeys]}
          tableRows={(data?.overTime ?? []).map(row => [
            String(row.date),
            ...overTimeKeys.map(k => (row[k] as number) ?? 0),
          ])}
          summaryLines={[
            `Total findings: ${data?.kpis.totalFindings ?? 0}`,
            `Top category: ${data?.kpis.topCategory ?? "none"}`,
          ]}
        >
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={data?.overTime ?? []}>
              <CartesianGrid stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="date" tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 11 }} />
              <YAxis tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 11 }} allowDecimals={false} />
              <Tooltip
                contentStyle={{ background: "#111827", border: "1px solid rgba(255,255,255,0.1)" }}
              />
              <Legend />
              {overTimeKeys.map((k, i) => (
                <Area
                  key={k}
                  type="monotone"
                  dataKey={k}
                  stackId="1"
                  stroke={CHART_COLORS[i % CHART_COLORS.length]}
                  fill={CHART_COLORS[i % CHART_COLORS.length]}
                  fillOpacity={0.35}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </ChartFrame>

        <ChartFrame
          title="Findings by category"
          interpretation="Which sensitive-data categories appear most often after scrubbing."
          rangeLabel={rangeLabel}
          workspaceLabel={workspaceLabel}
          loading={loading}
          error={error}
          empty={!loading && (data?.byCategory.length ?? 0) === 0}
          tableHeaders={["Category", "Count"]}
          tableRows={(data?.byCategory ?? []).map(r => [r.category, r.count])}
        >
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data?.byCategory ?? []} layout="vertical" margin={{ left: 24 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.06)" horizontal={false} />
              <XAxis type="number" tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 11 }} allowDecimals={false} />
              <YAxis
                type="category"
                dataKey="category"
                width={100}
                tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 11 }}
              />
              <Tooltip contentStyle={{ background: "#111827", border: "1px solid rgba(255,255,255,0.1)" }} />
              <Bar dataKey="count" fill="#818cf8" name="Findings" />
            </BarChart>
          </ResponsiveContainer>
        </ChartFrame>

        <ChartFrame
          title="Outcomes"
          interpretation="Blocked, redacted, safe-listed, and dismissed — only when those actions were recorded."
          rangeLabel={rangeLabel}
          workspaceLabel={workspaceLabel}
          loading={loading}
          error={error}
          empty={!loading && (data?.byOutcome.length ?? 0) === 0}
          tableHeaders={["Outcome", "Count"]}
          tableRows={(data?.byOutcome ?? []).map(r => [r.outcome, r.count])}
        >
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data?.byOutcome ?? []}>
              <CartesianGrid stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="outcome" tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 11 }} />
              <YAxis tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 11 }} allowDecimals={false} />
              <Tooltip contentStyle={{ background: "#111827", border: "1px solid rgba(255,255,255,0.1)" }} />
              <Bar dataKey="count" fill="#34d399" name="Events" />
            </BarChart>
          </ResponsiveContainer>
        </ChartFrame>

        <ChartFrame
          title="Source"
          interpretation="Where findings originated: Investigate chat, Knowledge documents, or image OCR."
          rangeLabel={rangeLabel}
          workspaceLabel={workspaceLabel}
          loading={loading}
          error={error}
          empty={!loading && (data?.bySource.length ?? 0) === 0}
          tableHeaders={["Source", "Count"]}
          tableRows={(data?.bySource ?? []).map(r => [r.source, r.count])}
        >
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data?.bySource ?? []} layout="vertical" margin={{ left: 16 }}>
              <CartesianGrid stroke="rgba(255,255,255,0.06)" horizontal={false} />
              <XAxis type="number" tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 11 }} allowDecimals={false} />
              <YAxis type="category" dataKey="source" width={120} tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 11 }} />
              <Tooltip contentStyle={{ background: "#111827", border: "1px solid rgba(255,255,255,0.1)" }} />
              <Bar dataKey="count" fill="#22d3ee" name="Findings" />
            </BarChart>
          </ResponsiveContainer>
        </ChartFrame>
      </div>

      <ChartFrame
        title="Workspace comparison"
        interpretation="Finding volume by workspace in the current filter scope."
        rangeLabel={rangeLabel}
        workspaceLabel={workspaceLabel}
        loading={loading}
        error={error}
        empty={!loading && (data?.byWorkspace.length ?? 0) === 0}
        tableHeaders={["Workspace", "Count"]}
        tableRows={(data?.byWorkspace ?? []).map(r => [r.name, r.count])}
      >
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data?.byWorkspace ?? []} layout="vertical" margin={{ left: 16 }}>
            <CartesianGrid stroke="rgba(255,255,255,0.06)" horizontal={false} />
            <XAxis type="number" tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 11 }} allowDecimals={false} />
            <YAxis type="category" dataKey="name" width={140} tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 11 }} />
            <Tooltip contentStyle={{ background: "#111827", border: "1px solid rgba(255,255,255,0.1)" }} />
            <Bar dataKey="count" fill="#a78bfa" name="Findings" />
          </BarChart>
        </ResponsiveContainer>
      </ChartFrame>

      <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
        <h3 className="text-sm font-semibold text-white/90 mb-3">Event history</h3>
        {loading && <p className="text-sm text-white/40">Loading…</p>}
        {error && <p className="text-sm text-rose-300/80">{error}</p>}
        {!loading && !error && filteredEvents.length === 0 && (
          <p className="text-sm text-white/35">No security events in this filter set yet.</p>
        )}
        {!loading && filteredEvents.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="text-white/40 border-b border-white/10">
                  <th className="py-2 pr-3">When</th>
                  <th className="py-2 pr-3">Category</th>
                  <th className="py-2 pr-3">Risk</th>
                  <th className="py-2 pr-3">Outcome</th>
                  <th className="py-2 pr-3">Source</th>
                  <th className="py-2">Count</th>
                </tr>
              </thead>
              <tbody>
                {filteredEvents.slice(0, 100).map(e => (
                  <tr key={e.id} className="border-b border-white/5 text-white/70">
                    <td className="py-2 pr-3 whitespace-nowrap">{new Date(e.at).toLocaleString()}</td>
                    <td className="py-2 pr-3">{e.category}</td>
                    <td className="py-2 pr-3">{e.riskLevel}</td>
                    <td className="py-2 pr-3">{e.outcome}</td>
                    <td className="py-2 pr-3">{e.source}</td>
                    <td className="py-2 tabular-nums">{e.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </AnalyticsShell>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <label className="text-xs text-white/45">
      {label}
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="mt-1 block rounded-md border border-white/10 bg-black/30 px-2.5 py-1.5 text-sm text-white/85"
      >
        <option value="all">All</option>
        {options.map(o => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}
