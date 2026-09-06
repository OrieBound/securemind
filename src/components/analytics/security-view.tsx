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
import {
  AnalyticsShell,
  rangeLabelOf,
  useAnalyticsFilters,
  type InsightsSubjectScope,
} from "./analytics-shell";
import { ChartFrame } from "./chart-frame";
import { tooltipStyle, useChartTheme } from "./use-chart-theme";
import { KpiCard } from "./kpi-card";
import { useAnalyticsQuery } from "./use-analytics-query";
import {
  DetectionForwardOnlyNotice,
  DetectionPolicyExplainer,
  DetectionPolicyMatrix,
} from "@/components/app/detection-policy-panel";
import { DEFAULT_SENSITIVITY, parsePiiSensitivityTier, type PiiSensitivityTier } from "@/lib/pii";

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
  byDocument: { documentId: string; name: string; count: number }[];
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
    resourceKind?: string | null;
    resourceId?: string | null;
    resourceName?: string | null;
  }[];
};

const SOURCE_LABELS: Record<string, string> = {
  investigate: "Chat",
  knowledge_document: "Knowledge document",
  image_ocr: "Image OCR",
};

function sourceLabel(source: string) {
  return SOURCE_LABELS[source] ?? source;
}


type Props = {
  workspaces: WorkspaceOpt[];
  subject?: InsightsSubjectScope | null;
  onBackToAdmin?: () => void;
  onEditPolicy?: () => void;
};

export function SecurityAnalyticsView({
  workspaces,
  subject = null,
  onBackToAdmin,
  onEditPolicy,
}: Props) {
  const chart = useChartTheme();
  const { range, setRange, workspaceId, setWorkspaceId } = useAnalyticsFilters("30d");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [riskFilter, setRiskFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [outcomeFilter, setOutcomeFilter] = useState("all");
  const asUser = subject?.userId ?? null;
  const { data, loading, error, retry } = useAnalyticsQuery<SecurityPayload>("security", {
    range,
    workspaceId,
    asUser,
  });

  const [policyTier, setPolicyTier] = useState<PiiSensitivityTier>(DEFAULT_SENSITIVITY);
  const [safeTermCount, setSafeTermCount] = useState<number | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    void (async () => {
      try {
        const res = await fetch("/api/settings/security", { signal: ac.signal });
        if (!res.ok) return;
        const body = await res.json() as {
          piiSensitivity?: PiiSensitivityTier;
          safeTerms?: unknown[];
        };
        if (body.piiSensitivity) {
          const parsed = parsePiiSensitivityTier(body.piiSensitivity);
          if (parsed) setPolicyTier(parsed);
        }
        if (Array.isArray(body.safeTerms)) setSafeTermCount(body.safeTerms.length);
      } catch {
        /* offline — matrix still shows the catalog */
      }
    })();
    return () => ac.abort();
  }, []);

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
      subtitle="Detected-finding metadata only — raw matched values are not stored or charted. Detection is best-effort."
      workspaces={workspaces}
      range={range}
      workspaceId={workspaceId}
      onRangeChange={setRange}
      onWorkspaceChange={setWorkspaceId}
      subject={subject}
      onBackToAdmin={onBackToAdmin}
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
      {error && (
        <div className="flex items-center gap-3 text-sm text-destructive">
          <span>{error}</span>
          <button type="button" onClick={retry} className="underline text-foreground">
            Retry
          </button>
        </div>
      )}

      <section className="rounded-xl border border-foreground/10 bg-foreground/[0.03] p-4 sm:p-5 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground/90">Detection policy</h3>
            <p className="text-xs text-foreground/40 mt-1 max-w-2xl leading-relaxed">
              What each sensitivity tier includes. Insights counts findings that already
              happened; this table is the rule that runs on the next chat send or Knowledge ingest.
            </p>
          </div>
          {onEditPolicy && (
            <button
              type="button"
              onClick={onEditPolicy}
              className="shrink-0 rounded-lg border border-indigo-500/35 bg-indigo-500/15 px-3 py-1.5 text-[0.7rem] font-medium text-indigo-100 cursor-pointer hover:bg-indigo-500/25"
            >
              Edit in Settings
            </button>
          )}
        </div>
        <DetectionForwardOnlyNotice />
        <DetectionPolicyMatrix currentTier={policyTier} />
        <DetectionPolicyExplainer
          currentTier={policyTier}
          safeTermCount={safeTermCount ?? undefined}
        />
      </section>

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
              <CartesianGrid stroke={chart.grid} />
              <XAxis dataKey="date" tick={{ fill: chart.tick, fontSize: 11 }} />
              <YAxis tick={{ fill: chart.tick, fontSize: 11 }} allowDecimals={false} />
              <Tooltip
                contentStyle={tooltipStyle(chart)}
              />
              <Legend />
              {overTimeKeys.map((k, i) => (
                <Area
                  key={k}
                  type="monotone"
                  dataKey={k}
                  stackId="1"
                  stroke={chart.series[i % chart.series.length]}
                  fill={chart.series[i % chart.series.length]}
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
              <CartesianGrid stroke={chart.grid} horizontal={false} />
              <XAxis type="number" tick={{ fill: chart.tick, fontSize: 11 }} allowDecimals={false} />
              <YAxis
                type="category"
                dataKey="category"
                width={100}
                tick={{ fill: chart.tick, fontSize: 11 }}
              />
              <Tooltip contentStyle={tooltipStyle(chart)} />
              <Bar dataKey="count" fill={chart.series[0]} name="Findings" />
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
              <CartesianGrid stroke={chart.grid} />
              <XAxis dataKey="outcome" tick={{ fill: chart.tick, fontSize: 11 }} />
              <YAxis tick={{ fill: chart.tick, fontSize: 11 }} allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle(chart)} />
              <Bar dataKey="count" fill={chart.series[3]} name="Events" />
            </BarChart>
          </ResponsiveContainer>
        </ChartFrame>

        <ChartFrame
          title="Source"
          interpretation="Where findings originated: Chat, Knowledge documents, or image OCR."
          rangeLabel={rangeLabel}
          workspaceLabel={workspaceLabel}
          loading={loading}
          error={error}
          empty={!loading && (data?.bySource.length ?? 0) === 0}
          tableHeaders={["Source", "Count"]}
          tableRows={(data?.bySource ?? []).map(r => [sourceLabel(r.source), r.count])}
        >
          <ResponsiveContainer width="100%" height={240}>
            <BarChart
              data={(data?.bySource ?? []).map(r => ({ ...r, label: sourceLabel(r.source) }))}
              layout="vertical"
              margin={{ left: 16 }}
            >
              <CartesianGrid stroke={chart.grid} horizontal={false} />
              <XAxis type="number" tick={{ fill: chart.tick, fontSize: 11 }} allowDecimals={false} />
              <YAxis type="category" dataKey="label" width={130} tick={{ fill: chart.tick, fontSize: 11 }} />
              <Tooltip contentStyle={tooltipStyle(chart)} />
              <Bar dataKey="count" fill={chart.series[1]} name="Findings" />
            </BarChart>
          </ResponsiveContainer>
        </ChartFrame>
      </div>

      <ChartFrame
        title="By document"
        interpretation="Knowledge / OCR findings grouped by the uploaded file that was scanned. Filenames only — never the matched values."
        rangeLabel={rangeLabel}
        workspaceLabel={workspaceLabel}
        loading={loading}
        error={error}
        empty={!loading && (data?.byDocument?.length ?? 0) === 0}
        tableHeaders={["Document", "Count"]}
        tableRows={(data?.byDocument ?? []).map(r => [r.name, r.count])}
      >
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data?.byDocument ?? []} layout="vertical" margin={{ left: 16 }}>
            <CartesianGrid stroke={chart.grid} horizontal={false} />
            <XAxis type="number" tick={{ fill: chart.tick, fontSize: 11 }} allowDecimals={false} />
            <YAxis
              type="category"
              dataKey="name"
              width={160}
              tick={{ fill: chart.tick, fontSize: 11 }}
              tickFormatter={(v: string) => (v.length > 28 ? `${v.slice(0, 26)}…` : v)}
            />
            <Tooltip contentStyle={tooltipStyle(chart)} />
            <Bar dataKey="count" fill={chart.series[4]} name="Findings" />
          </BarChart>
        </ResponsiveContainer>
      </ChartFrame>

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
            <CartesianGrid stroke={chart.grid} horizontal={false} />
            <XAxis type="number" tick={{ fill: chart.tick, fontSize: 11 }} allowDecimals={false} />
            <YAxis type="category" dataKey="name" width={140} tick={{ fill: chart.tick, fontSize: 11 }} />
            <Tooltip contentStyle={tooltipStyle(chart)} />
            <Bar dataKey="count" fill={chart.series[2]} name="Findings" />
          </BarChart>
        </ResponsiveContainer>
      </ChartFrame>

      <section className="rounded-xl border border-foreground/10 bg-foreground/[0.03] p-4 sm:p-5">
        <h3 className="text-sm font-semibold text-foreground/90 mb-3">Event history</h3>
        {loading && <p className="text-sm text-foreground/40">Loading…</p>}
        {error && <p className="text-sm text-rose-300/80">{error}</p>}
        {!loading && !error && filteredEvents.length === 0 && (
          <p className="text-sm text-foreground/35">No security events in this filter set yet.</p>
        )}
        {!loading && filteredEvents.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="text-foreground/40 border-b border-foreground/10">
                  <th className="py-2 pr-3">When</th>
                  <th className="py-2 pr-3">Category</th>
                  <th className="py-2 pr-3">Risk</th>
                  <th className="py-2 pr-3">Outcome</th>
                  <th className="py-2 pr-3">Source</th>
                  <th className="py-2 pr-3">Document / detail</th>
                  <th className="py-2">Count</th>
                </tr>
              </thead>
              <tbody>
                {filteredEvents.slice(0, 100).map(e => (
                  <tr key={e.id} className="border-b border-foreground/5 text-foreground/70">
                    <td className="py-2 pr-3 whitespace-nowrap">{new Date(e.at).toLocaleString()}</td>
                    <td className="py-2 pr-3">{e.category}</td>
                    <td className="py-2 pr-3">{e.riskLevel}</td>
                    <td className="py-2 pr-3">{e.outcome}</td>
                    <td className="py-2 pr-3">{sourceLabel(e.source)}</td>
                    <td className="py-2 pr-3 max-w-[220px] truncate" title={e.resourceName ?? undefined}>
                      {e.resourceName ?? "—"}
                    </td>
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
    <label className="text-xs text-foreground/45">
      {label}
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="mt-1 block rounded-md border border-foreground/10 bg-foreground/[0.06] px-2.5 py-1.5 text-sm text-foreground/85"
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
