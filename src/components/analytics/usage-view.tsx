"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
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
import { DailyAmountChart } from "./daily-amount-chart";
import { tooltipStyle, useChartTheme } from "./use-chart-theme";
import { KpiCard } from "./kpi-card";
import { fmtPct, shortModel } from "@/lib/analytics/client";
import {
  bucketLatencyMs,
  fmtCount,
  fmtLatency,
  groundingStack,
  orderTierCounts,
  prefersDailyColumns,
} from "@/lib/analytics/chart-shape";
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

  const overTime = data?.overTime ?? [];
  const dailyAsColumns = prefersDailyColumns(overTime.length);
  const volumeNote = dailyAsColumns
    ? "Requests per day. Columns, because each day starts from zero and the range is still short."
    : "Requests per day. A straight line with a dot on each day.";
  const tiers = orderTierCounts(data?.byTier ?? []);
  const grounding = groundingStack(data?.byGrounding ?? []);
  const latencyBuckets = bucketLatencyMs(data?.latencySamples ?? []);
  const latencyHasSamples = latencyBuckets.some(bucket => bucket.count > 0);

  return (
    <AnalyticsShell
      active="usage"
      title="Usage"
      subtitle="Headline totals, then volume, routing, and grounding. Charts is the same picture without the workspace table. Refreshes about every 15 seconds. Not AWS infrastructure consumption."
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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="AI requests" value={loading ? "…" : fmtCount(data?.kpis.totalRequests ?? 0)} />
        <KpiCard label="Success rate" value={loading ? "…" : fmtPct(data?.kpis.successRate)} />
        <KpiCard label="Retrieval hits" value={loading ? "…" : fmtPct(data?.kpis.retrievalHitRate)} />
        <KpiCard
          label="Grounded answers"
          value={loading ? "…" : fmtPct(data?.kpis.groundedRate)}
          hint="Share of answers that were asked to cite"
        />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Input tokens" value={loading ? "…" : fmtCount(data?.kpis.promptTokens ?? 0)} />
        <KpiCard label="Output tokens" value={loading ? "…" : fmtCount(data?.kpis.completionTokens ?? 0)} />
        <KpiCard label="Avg latency" value={loading ? "…" : fmtLatency(data?.kpis.avgLatencyMs)} />
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

      <div id="usage-charts" role="tabpanel" className="space-y-5">
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <ChartFrame
          title="Request volume"
          interpretation={volumeNote}
          rangeLabel={rangeLabel}
          workspaceLabel={workspaceLabel}
          loading={loading}
          error={error}
          empty={!loading && overTime.length === 0}
          tableHeaders={["Date", "Requests"]}
          tableRows={overTime.map(r => [r.date, r.requests])}
        >
          <DailyAmountChart
            data={overTime}
            dataKey="requests"
            name="Requests"
            color={chart.series[0]}
            chart={chart}
          />
        </ChartFrame>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 xl:col-span-2">
          <ChartFrame
            title="Input tokens"
            interpretation="Input tokens per day, on their own scale."
            rangeLabel={rangeLabel}
            workspaceLabel={workspaceLabel}
            loading={loading}
            error={error}
            empty={!loading && overTime.length === 0}
            tableHeaders={["Date", "Input"]}
            tableRows={overTime.map(r => [r.date, r.prompt])}
          >
            <DailyAmountChart
              data={overTime}
              dataKey="prompt"
              name="Input"
              color={chart.series[3]}
              chart={chart}
            />
          </ChartFrame>
          <ChartFrame
            title="Output tokens"
            interpretation="Output tokens per day, on their own scale."
            rangeLabel={rangeLabel}
            workspaceLabel={workspaceLabel}
            loading={loading}
            error={error}
            empty={!loading && overTime.length === 0}
            tableHeaders={["Date", "Output"]}
            tableRows={overTime.map(r => [r.date, r.completion])}
          >
            <DailyAmountChart
              data={overTime}
              dataKey="completion"
              name="Output"
              color={chart.series[4]}
              chart={chart}
            />
          </ChartFrame>
        </div>

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
          title="Routing tiers"
          interpretation="Complexity tiers from Max to Micro. Unused tiers stay in place so the mix is readable."
          rangeLabel={rangeLabel}
          workspaceLabel={workspaceLabel}
          loading={loading}
          error={error}
          empty={!loading && tiers.length === 0}
          tableHeaders={["Tier", "Requests"]}
          tableRows={tiers.map(r => [r.tier, r.count])}
        >
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={tiers}>
              <CartesianGrid stroke={chart.grid} vertical={false} />
              <XAxis dataKey="tier" tick={{ fill: chart.tick, fontSize: 11 }} />
              <YAxis tick={{ fill: chart.tick, fontSize: 11 }} allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle(chart)} />
              <Bar dataKey="count" fill={chart.series[1]} name="Requests" maxBarSize={48} />
            </BarChart>
          </ResponsiveContainer>
        </ChartFrame>

        <ChartFrame
          title="Citation outcomes"
          interpretation={
            grounding.notApplicable > 0
              ? `${fmtCount(grounding.notApplicable)} turns were outside citation, such as a greeting, and are not in this stack.`
              : "Grounded, partial, and uncited answers. Social turns are left out."
          }
          rangeLabel={rangeLabel}
          workspaceLabel={workspaceLabel}
          loading={loading}
          error={error}
          empty={!loading && grounding.series.length === 0}
          tableHeaders={["Outcome", "Count"]}
          tableRows={grounding.series.map(label => [label, grounding.point[label] ?? 0])}
        >
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={[grounding.point]}>
              <CartesianGrid stroke={chart.grid} vertical={false} />
              <XAxis dataKey="label" tick={{ fill: chart.tick, fontSize: 11 }} />
              <YAxis tick={{ fill: chart.tick, fontSize: 11 }} allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle(chart)} />
              <Legend />
              {grounding.series.map((label, i) => (
                <Bar
                  key={label}
                  dataKey={label}
                  stackId="cited"
                  fill={chart.series[i % chart.series.length]}
                  name={label}
                  maxBarSize={72}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </ChartFrame>

        <ChartFrame
          title="Response time"
          interpretation={
            data?.kpis.avgLatencyMs != null
              ? `How long replies took. Average ${fmtLatency(data.kpis.avgLatencyMs)}.`
              : "How long replies took, once the stream completes."
          }
          rangeLabel={rangeLabel}
          workspaceLabel={workspaceLabel}
          loading={loading}
          error={error}
          empty={!loading && !latencyHasSamples}
          tableHeaders={["Bucket", "Requests"]}
          tableRows={latencyBuckets.map(bucket => [bucket.label, bucket.count])}
        >
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={latencyBuckets}>
              <CartesianGrid stroke={chart.grid} vertical={false} />
              <XAxis dataKey="label" tick={{ fill: chart.tick, fontSize: 11 }} />
              <YAxis tick={{ fill: chart.tick, fontSize: 11 }} allowDecimals={false} />
              <Tooltip contentStyle={tooltipStyle(chart)} />
              <Bar dataKey="count" fill={chart.series[5]} name="Requests" maxBarSize={48} />
            </BarChart>
          </ResponsiveContainer>
        </ChartFrame>
      </div>
      </div>
    </AnalyticsShell>
  );
}
