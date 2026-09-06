"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AnalyticsShell,
  rangeLabelOf,
  useAnalyticsFilters,
  useSectionHash,
  type InsightsSubjectScope,
} from "./analytics-shell";
import { ChartFrame } from "./chart-frame";
import { tooltipStyle, useChartTheme } from "./use-chart-theme";
import { KpiCard } from "./kpi-card";
import { fmtPct, shortModel } from "@/lib/analytics/client";
import { useAnalyticsQuery } from "./use-analytics-query";
import { USAGE_SECTION_HREF, usagePageSection } from "@/lib/analytics/usage-hash";

type WorkspaceOpt = { id: string; name: string };

type UsagePayload = {
  kpis: {
    totalRequests: number;
    promptTokens: number;
    completionTokens: number;
    avgLatencyMs: number | null;
    successRate: number | null;
    groundedRate: number | null;
    retrievalHitRate: number | null;
    citationUsageRate: number | null;
    topModel: string | null;
  };
  overTime: { date: string; requests: number; prompt: number; completion: number }[];
  byModel: { model: string; count: number }[];
  byTier: { tier: string; count: number }[];
  byGrounding: { status: string; count: number }[];
  byWorkspace: { workspaceId: string; name: string; requests: number; prompt: number; completion: number }[];
  latencySamples: number[];
};

type Props = {
  workspaces: WorkspaceOpt[];
  subject?: InsightsSubjectScope | null;
  onBackToAdmin?: () => void;
};

export function UsageAnalyticsView({ workspaces, subject = null, onBackToAdmin }: Props) {
  const chart = useChartTheme();
  const { range, setRange, workspaceId, setWorkspaceId } = useAnalyticsFilters("30d");
  const { locationHash, selectSectionTab } = useSectionHash();
  const pageSection = usagePageSection(locationHash);
  const asUser = subject?.userId ?? null;
  const { data, loading, error, retry } = useAnalyticsQuery<UsagePayload>("usage", {
    range,
    workspaceId,
    asUser,
    pollMs: 15_000,
  });

  const rangeLabel = rangeLabelOf(range);
  const workspaceLabel =
    workspaceId === "all"
      ? "All workspaces"
      : workspaces.find(w => w.id === workspaceId)?.name ?? "Workspace";

  const latencyTrend = (data?.overTime ?? []).map((row, i, arr) => {
    // Approximate: use overall avg as flat line when per-day latency isn't stored
    const avg = data?.kpis.avgLatencyMs;
    return { date: row.date, latencyMs: avg, requests: row.requests, _i: i, _n: arr.length };
  });

  return (
    <AnalyticsShell
      active="usage"
      title="Usage"
      subtitle="Request totals and by-workspace on Overview; volume, routing, and grounding charts on Charts. Refreshes about every 15 seconds. Not AWS infrastructure consumption."
      workspaces={workspaces}
      range={range}
      workspaceId={workspaceId}
      onRangeChange={setRange}
      onWorkspaceChange={setWorkspaceId}
      subject={subject}
      onBackToAdmin={onBackToAdmin}
      sectionTablistLabel="Usage sections"
      sectionLinks={[
        { href: USAGE_SECTION_HREF.overview, label: "Overview" },
        { href: USAGE_SECTION_HREF.charts, label: "Charts" },
      ]}
      activeSectionHref={
        pageSection === "charts" ? USAGE_SECTION_HREF.charts : USAGE_SECTION_HREF.overview
      }
      onSectionTab={selectSectionTab}
    >
      {error && (
        <div className="flex items-center gap-3 text-sm text-destructive">
          <span>{error}</span>
          <button type="button" onClick={retry} className="underline text-foreground">
            Retry
          </button>
        </div>
      )}

      {pageSection === "overview" && (
      <div id="usage-overview" role="tabpanel" className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        <KpiCard label="AI requests" value={loading ? "…" : String(data?.kpis.totalRequests ?? 0)} />
        <KpiCard label="Input tokens" value={loading ? "…" : String(data?.kpis.promptTokens ?? 0)} />
        <KpiCard label="Output tokens" value={loading ? "…" : String(data?.kpis.completionTokens ?? 0)} />
        <KpiCard
          label="Avg latency"
          value={loading ? "…" : data?.kpis.avgLatencyMs != null ? `${data.kpis.avgLatencyMs} ms` : "—"}
        />
        <KpiCard label="Success rate" value={loading ? "…" : fmtPct(data?.kpis.successRate)} />
        <KpiCard label="Grounded answers" value={loading ? "…" : fmtPct(data?.kpis.groundedRate)} />
        <KpiCard label="Retrieval hits" value={loading ? "…" : fmtPct(data?.kpis.retrievalHitRate)} />
        <KpiCard label="Most-used model" value={loading ? "…" : shortModel(data?.kpis.topModel)} />
      </div>

      <section className="rounded-xl border border-foreground/10 bg-foreground/[0.03] p-4 sm:p-5">
        <h3 className="text-sm font-semibold text-foreground/90 mb-3">By workspace</h3>
        {!loading && (data?.byWorkspace.length ?? 0) === 0 && (
          <p className="text-sm text-foreground/35">No usage events yet. Ask a question in Chat to start recording.</p>
        )}
        {(data?.byWorkspace.length ?? 0) > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="text-foreground/40 border-b border-foreground/10">
                  <th className="py-2 pr-3">Workspace</th>
                  <th className="py-2 pr-3">Requests</th>
                  <th className="py-2 pr-3">Input tokens</th>
                  <th className="py-2">Output tokens</th>
                </tr>
              </thead>
              <tbody>
                {(data?.byWorkspace ?? []).map(r => (
                  <tr key={r.workspaceId} className="border-b border-foreground/5 text-foreground/70">
                    <td className="py-2 pr-3">{r.name}</td>
                    <td className="py-2 pr-3 tabular-nums">{r.requests}</td>
                    <td className="py-2 pr-3 tabular-nums">{r.prompt}</td>
                    <td className="py-2 tabular-nums">{r.completion}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      </div>
      )}

      {pageSection === "charts" && (
      <div id="usage-charts" role="tabpanel" className="space-y-5">
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <ChartFrame
          title="Request volume over time"
          interpretation="How many AI requests SecureMind handled per day."
          rangeLabel={rangeLabel}
          workspaceLabel={workspaceLabel}
          loading={loading}
          error={error}
          empty={!loading && (data?.overTime.length ?? 0) === 0}
          tableHeaders={["Date", "Requests"]}
          tableRows={(data?.overTime ?? []).map(r => [r.date, r.requests])}
        >
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={data?.overTime ?? []}>
              <CartesianGrid stroke={chart.grid} />
              <XAxis dataKey="date" tick={{ fill: chart.tick, fontSize: 11 }} />
              <YAxis tick={{ fill: chart.tick, fontSize: 11 }} allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle(chart)} />
              <Line type="monotone" dataKey="requests" stroke={chart.series[0]} strokeWidth={2} dot={false} name="Requests" />
            </LineChart>
          </ResponsiveContainer>
        </ChartFrame>

        <ChartFrame
          title="Input and output tokens"
          interpretation="Token volume over time — separate series, not a dual-axis mix with requests."
          rangeLabel={rangeLabel}
          workspaceLabel={workspaceLabel}
          loading={loading}
          error={error}
          empty={!loading && (data?.overTime.length ?? 0) === 0}
          tableHeaders={["Date", "Input", "Output"]}
          tableRows={(data?.overTime ?? []).map(r => [r.date, r.prompt, r.completion])}
        >
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={data?.overTime ?? []}>
              <CartesianGrid stroke={chart.grid} />
              <XAxis dataKey="date" tick={{ fill: chart.tick, fontSize: 11 }} />
              <YAxis tick={{ fill: chart.tick, fontSize: 11 }} allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle(chart)} />
              <Legend />
              <Line type="monotone" dataKey="prompt" stroke={chart.series[3]} strokeWidth={2} dot={false} name="Input" />
              <Line type="monotone" dataKey="completion" stroke={chart.series[4]} strokeWidth={2} dot={false} name="Output" />
            </LineChart>
          </ResponsiveContainer>
        </ChartFrame>

        <ChartFrame
          title="Requests by model"
          interpretation="Which models handled requests in this period."
          rangeLabel={rangeLabel}
          workspaceLabel={workspaceLabel}
          loading={loading}
          error={error}
          empty={!loading && (data?.byModel.length ?? 0) === 0}
          tableHeaders={["Model", "Requests"]}
          tableRows={(data?.byModel ?? []).map(r => [shortModel(r.model), r.count])}
        >
          <ResponsiveContainer width="100%" height={240}>
            <BarChart
              data={(data?.byModel ?? []).map(r => ({ ...r, label: shortModel(r.model) }))}
              layout="vertical"
              margin={{ left: 8 }}
            >
              <CartesianGrid stroke={chart.grid} horizontal={false} />
              <XAxis type="number" tick={{ fill: chart.tick, fontSize: 11 }} allowDecimals={false} />
              <YAxis type="category" dataKey="label" width={110} tick={{ fill: chart.tick, fontSize: 11 }} />
              <Tooltip contentStyle={tooltipStyle(chart)} />
              <Bar dataKey="count" fill={chart.series[0]} name="Requests" />
            </BarChart>
          </ResponsiveContainer>
        </ChartFrame>

        <ChartFrame
          title="Routing-tier distribution"
          interpretation="Complexity tiers selected for Chat turns."
          rangeLabel={rangeLabel}
          workspaceLabel={workspaceLabel}
          loading={loading}
          error={error}
          empty={!loading && (data?.byTier.length ?? 0) === 0}
          tableHeaders={["Tier", "Requests"]}
          tableRows={(data?.byTier ?? []).map(r => [r.tier, r.count])}
        >
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data?.byTier ?? []}>
              <CartesianGrid stroke={chart.grid} />
              <XAxis dataKey="tier" tick={{ fill: chart.tick, fontSize: 11 }} />
              <YAxis tick={{ fill: chart.tick, fontSize: 11 }} allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle(chart)} />
              <Bar dataKey="count" fill={chart.series[1]} name="Requests" />
            </BarChart>
          </ResponsiveContainer>
        </ChartFrame>

        <ChartFrame
          title="Grounding distribution"
          interpretation="Citation-audit outcomes: grounded, partial, uncited, invalid, declined."
          rangeLabel={rangeLabel}
          workspaceLabel={workspaceLabel}
          loading={loading}
          error={error}
          empty={!loading && (data?.byGrounding.length ?? 0) === 0}
          tableHeaders={["Status", "Count"]}
          tableRows={(data?.byGrounding ?? []).map(r => [r.status, r.count])}
        >
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data?.byGrounding ?? []}>
              <CartesianGrid stroke={chart.grid} />
              <XAxis dataKey="status" tick={{ fill: chart.tick, fontSize: 11 }} />
              <YAxis tick={{ fill: chart.tick, fontSize: 11 }} allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle(chart)} />
              <Bar dataKey="count" fill={chart.series[3]} name="Answers" />
            </BarChart>
          </ResponsiveContainer>
        </ChartFrame>

        <ChartFrame
          title="Response latency"
          interpretation={
            data?.kpis.avgLatencyMs != null
              ? `Average latency ${data.kpis.avgLatencyMs} ms across recorded requests in this period.`
              : "Latency is recorded per request when the stream completes."
          }
          rangeLabel={rangeLabel}
          workspaceLabel={workspaceLabel}
          loading={loading}
          error={error}
          empty={!loading && (data?.kpis.avgLatencyMs == null || (data?.overTime.length ?? 0) === 0)}
          tableHeaders={["Date", "Requests", "Avg latency (period)"]}
          tableRows={latencyTrend.map(r => [r.date, r.requests, r.latencyMs ?? "—"])}
        >
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={latencyTrend}>
              <CartesianGrid stroke={chart.grid} />
              <XAxis dataKey="date" tick={{ fill: chart.tick, fontSize: 11 }} />
              <YAxis tick={{ fill: chart.tick, fontSize: 11 }} />
              <Tooltip contentStyle={tooltipStyle(chart)} />
              <Line type="monotone" dataKey="latencyMs" stroke={chart.series[5]} strokeWidth={2} dot={false} name="Avg latency (ms)" />
            </LineChart>
          </ResponsiveContainer>
        </ChartFrame>
      </div>
      </div>
      )}
    </AnalyticsShell>
  );
}
