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
  type InsightsSubjectScope,
} from "./analytics-shell";
import { ChartFrame } from "./chart-frame";
import { tooltipStyle, useChartTheme } from "./use-chart-theme";
import { KpiCard } from "./kpi-card";
import { fmtUsd, fmtUsdLabeled, shortModel } from "@/lib/analytics/client";
import { useAnalyticsQuery } from "./use-analytics-query";
import { RateTableEditor } from "./rate-table-editor";
import { cn } from "@/lib/utils";

type WorkspaceOpt = { id: string; name: string };

type CostPayload = {
  disclaimer: string;
  pricing: { version: string; effective: string; baselineModel: string };
  kpis: {
    estimatedCostUsd: number;
    avgCostPerRequest: number | null;
    inputTokenCostUsd: number;
    outputTokenCostUsd: number;
    routingSavingsUsd: number;
    projectedMonthlyUsd: number | null;
    pricedRequests: number;
    unpricedRequests: number;
  };
  overTime: { date: string; costUsd: number }[];
  byModel: { model: string; costUsd: number }[];
  byWorkspace: { workspaceId: string; name: string; costUsd: number }[];
  vsBaseline: {
    actualUsd: number;
    baselineUsd: number;
    savingsUsd: number;
    explanation: string;
  };
  monthCap?: {
    spentUsd: number;
    capUsd: number | null;
    resetsAt: string;
    capped: boolean;
    warningLevel?: "none" | "warn50" | "warn80" | "blocked";
  };
};

type Props = {
  workspaces: WorkspaceOpt[];
  subject?: InsightsSubjectScope | null;
  onBackToAdmin?: () => void;
};

export function CostAnalyticsView({ workspaces, subject = null, onBackToAdmin }: Props) {
  const chart = useChartTheme();
  const { range, setRange, workspaceId, setWorkspaceId } = useAnalyticsFilters("30d");
  const asUser = subject?.userId ?? null;
  const { data, loading, error, retry } = useAnalyticsQuery<CostPayload>("cost", {
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

  const disclaimer = data?.disclaimer;
  const ioRows = data
    ? [
        { label: "Input tokens", costUsd: data.kpis.inputTokenCostUsd },
        { label: "Output tokens", costUsd: data.kpis.outputTokenCostUsd },
      ]
    : [];
  const baselineRows = data
    ? [
        { label: "Actual routed", costUsd: data.vsBaseline.actualUsd },
        { label: `Baseline (${shortModel(data.pricing.baselineModel)})`, costUsd: data.vsBaseline.baselineUsd },
      ]
    : [];

  const monthCap = data?.monthCap;
  const monthPct =
    monthCap && monthCap.capUsd != null && monthCap.capUsd > 0
      ? Math.min(100, (monthCap.spentUsd / monthCap.capUsd) * 100)
      : null;
  const resetLabel = monthCap?.resetsAt
    ? new Date(monthCap.resetsAt).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      }) + " UTC"
    : null;

  return (
    <AnalyticsShell
      active="cost"
      title="Estimated AI inference cost"
      subtitle="Conservative list-price estimates (+10% uplift) from recorded token usage. Refreshes about every 15 seconds while this page is open. Not an invoice or full AWS bill."
      workspaces={workspaces}
      range={range}
      workspaceId={workspaceId}
      onRangeChange={setRange}
      onWorkspaceChange={setWorkspaceId}
      subject={subject}
      onBackToAdmin={onBackToAdmin}
    >
      {error && (
        <div className="flex items-center gap-3 text-sm text-destructive">
          <span>{error}</span>
          <button type="button" onClick={retry} className="underline text-foreground">
            Retry
          </button>
        </div>
      )}
      {monthCap && (
        <div
          className={cn(
            "rounded-xl border px-4 py-3 space-y-2",
            monthCap.capped
              ? "border-[var(--destructive-border)] bg-[var(--destructive-soft)]"
              : "border-border bg-card",
          )}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">This month (UTC)</h3>
            {resetLabel && (
              <p className="text-[0.65rem] text-muted-foreground">Resets {resetLabel}</p>
            )}
          </div>
          <p className="text-lg font-semibold tabular-nums text-foreground">
            {loading ? "…" : fmtUsdLabeled(monthCap.spentUsd)}
            <span className="text-sm font-normal text-muted-foreground">
              {" "}
              of {monthCap.capUsd == null ? "Unlimited" : fmtUsdLabeled(monthCap.capUsd)}
            </span>
          </p>
          {monthPct != null && (
            <div className="h-2 rounded-full bg-secondary overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full",
                  monthCap.capped || monthCap.warningLevel === "blocked"
                    ? "bg-destructive"
                    : monthPct >= 80 || monthCap.warningLevel === "warn80"
                      ? "bg-[var(--warning)]"
                      : monthPct >= 50 || monthCap.warningLevel === "warn50"
                        ? "bg-amber-400"
                        : "bg-primary",
                )}
                style={{ width: `${monthPct}%` }}
              />
            </div>
          )}
          {monthCap.warningLevel === "warn50" && (
            <p className="text-[0.7rem] text-amber-200/80">Approaching monthly cost cap (50%).</p>
          )}
          {monthCap.warningLevel === "warn80" && (
            <p className="text-[0.7rem] text-[var(--warning)]">Monthly cost cap nearly reached (80%).</p>
          )}
          {(monthCap.capped || monthCap.warningLevel === "blocked") && (
            <p className="text-[0.7rem] text-destructive">
              Monthly cost cap reached. Billable external calls are paused; local models can still run.
            </p>
          )}
          <p className="text-[0.7rem] text-muted-foreground">
            Estimates only — provider invoices remain authoritative.
          </p>
        </div>
      )}

      <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-100/70">
        {disclaimer ?? "Estimates only."}
        {data && (
          <span className="text-foreground/35">
            {" "}
            Pricing {data.pricing.version} (effective {data.pricing.effective}).
            {data.kpis.unpricedRequests > 0 &&
              ` ${data.kpis.unpricedRequests} request(s) used floor pricing (unknown model rate or missing tokens).`}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <KpiCard label="Estimated period cost" value={loading ? "…" : `${fmtUsd(data?.kpis.estimatedCostUsd)} USD`} />
        <KpiCard label="Avg cost / request" value={loading ? "…" : fmtUsd(data?.kpis.avgCostPerRequest)} />
        <KpiCard label="Input-token cost" value={loading ? "…" : fmtUsd(data?.kpis.inputTokenCostUsd)} />
        <KpiCard label="Output-token cost" value={loading ? "…" : fmtUsd(data?.kpis.outputTokenCostUsd)} />
        <KpiCard
          label="Routing savings (est.)"
          value={loading ? "…" : fmtUsd(data?.kpis.routingSavingsUsd)}
          hint="Vs documented premium baseline model"
        />
        <KpiCard
          label="Projected monthly"
          value={loading ? "…" : fmtUsd(data?.kpis.projectedMonthlyUsd)}
          hint="Estimate — needs ≥2 days of data"
        />
      </div>

      <RateTableEditor />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <ChartFrame
          title="Estimated cost over time"
          interpretation="Daily estimated inference spend from recorded Groq and Bedrock token usage."
          rangeLabel={rangeLabel}
          workspaceLabel={workspaceLabel}
          disclaimer={disclaimer}
          loading={loading}
          error={error}
          empty={!loading && (data?.overTime.length ?? 0) === 0}
          tableHeaders={["Date", "Estimated USD"]}
          tableRows={(data?.overTime ?? []).map(r => [r.date, r.costUsd.toFixed(6)])}
        >
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={data?.overTime ?? []}>
              <CartesianGrid stroke={chart.grid} />
              <XAxis dataKey="date" tick={{ fill: chart.tick, fontSize: 11 }} />
              <YAxis tick={{ fill: chart.tick, fontSize: 11 }} />
              <Tooltip
                contentStyle={tooltipStyle(chart)}
                formatter={(v) => fmtUsd(typeof v === "number" ? v : Number(v))}
              />
              <Line type="monotone" dataKey="costUsd" stroke={chart.series[4]} strokeWidth={2} dot={false} name="Est. USD" />
            </LineChart>
          </ResponsiveContainer>
        </ChartFrame>

        <ChartFrame
          title="Cost by model"
          interpretation="Estimated spend attributed to each model."
          rangeLabel={rangeLabel}
          workspaceLabel={workspaceLabel}
          disclaimer={disclaimer}
          loading={loading}
          error={error}
          empty={!loading && (data?.byModel.length ?? 0) === 0}
          tableHeaders={["Model", "Estimated USD"]}
          tableRows={(data?.byModel ?? []).map(r => [shortModel(r.model), r.costUsd.toFixed(6)])}
        >
          <ResponsiveContainer width="100%" height={240}>
            <BarChart
              data={(data?.byModel ?? []).map(r => ({ ...r, label: shortModel(r.model) }))}
              layout="vertical"
              margin={{ left: 8 }}
            >
              <CartesianGrid stroke={chart.grid} horizontal={false} />
              <XAxis type="number" tick={{ fill: chart.tick, fontSize: 11 }} />
              <YAxis type="category" dataKey="label" width={110} tick={{ fill: chart.tick, fontSize: 11 }} />
              <Tooltip
                contentStyle={tooltipStyle(chart)}
                formatter={(v) => fmtUsd(typeof v === "number" ? v : Number(v))}
              />
              <Bar dataKey="costUsd" fill={chart.series[4]} name="Est. USD" />
            </BarChart>
          </ResponsiveContainer>
        </ChartFrame>

        <ChartFrame
          title="Cost by workspace"
          interpretation="Estimated inference cost rolled up per workspace."
          rangeLabel={rangeLabel}
          workspaceLabel={workspaceLabel}
          disclaimer={disclaimer}
          loading={loading}
          error={error}
          empty={!loading && (data?.byWorkspace.length ?? 0) === 0}
          tableHeaders={["Workspace", "Estimated USD"]}
          tableRows={(data?.byWorkspace ?? []).map(r => [r.name, r.costUsd.toFixed(6)])}
        >
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data?.byWorkspace ?? []} layout="vertical" margin={{ left: 8 }}>
              <CartesianGrid stroke={chart.grid} horizontal={false} />
              <XAxis type="number" tick={{ fill: chart.tick, fontSize: 11 }} />
              <YAxis type="category" dataKey="name" width={140} tick={{ fill: chart.tick, fontSize: 11 }} />
              <Tooltip
                contentStyle={tooltipStyle(chart)}
                formatter={(v) => fmtUsd(typeof v === "number" ? v : Number(v))}
              />
              <Bar dataKey="costUsd" fill={chart.series[2]} name="Est. USD" />
            </BarChart>
          </ResponsiveContainer>
        </ChartFrame>

        <ChartFrame
          title="Input versus output token cost"
          interpretation="Approximate split of estimated spend between input and output tokens."
          rangeLabel={rangeLabel}
          workspaceLabel={workspaceLabel}
          disclaimer={disclaimer}
          loading={loading}
          error={error}
          empty={!loading && (data?.kpis.pricedRequests ?? 0) === 0}
          tableHeaders={["Part", "Estimated USD"]}
          tableRows={ioRows.map(r => [r.label, r.costUsd.toFixed(6)])}
        >
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={ioRows}>
              <CartesianGrid stroke={chart.grid} />
              <XAxis dataKey="label" tick={{ fill: chart.tick, fontSize: 11 }} />
              <YAxis tick={{ fill: chart.tick, fontSize: 11 }} />
              <Tooltip
                contentStyle={tooltipStyle(chart)}
                formatter={(v) => fmtUsd(typeof v === "number" ? v : Number(v))}
              />
              <Bar dataKey="costUsd" fill={chart.series[3]} name="Est. USD" />
            </BarChart>
          </ResponsiveContainer>
        </ChartFrame>
      </div>

      <ChartFrame
        title="Actual routing cost vs premium baseline"
        interpretation={data?.vsBaseline.explanation ?? "Baseline comparison uses a documented premium model, not AWS savings."}
        rangeLabel={rangeLabel}
        workspaceLabel={workspaceLabel}
        disclaimer={disclaimer}
        loading={loading}
        error={error}
        empty={!loading && (data?.kpis.pricedRequests ?? 0) === 0}
        tableHeaders={["Scenario", "Estimated USD"]}
        tableRows={baselineRows.map(r => [r.label, r.costUsd.toFixed(6)])}
        summaryLines={[
          `Actual: ${fmtUsd(data?.vsBaseline.actualUsd)}`,
          `Baseline: ${fmtUsd(data?.vsBaseline.baselineUsd)}`,
          `Estimated routing savings: ${fmtUsd(data?.vsBaseline.savingsUsd)}`,
        ]}
      >
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={baselineRows}>
            <CartesianGrid stroke={chart.grid} />
            <XAxis dataKey="label" tick={{ fill: chart.tick, fontSize: 11 }} />
            <YAxis tick={{ fill: chart.tick, fontSize: 11 }} />
            <Tooltip
              contentStyle={tooltipStyle(chart)}
              formatter={(v) => fmtUsd(typeof v === "number" ? v : Number(v))}
            />
            <Legend />
            <Bar dataKey="costUsd" fill={chart.series[5]} name="Est. USD" />
          </BarChart>
        </ResponsiveContainer>
      </ChartFrame>
    </AnalyticsShell>
  );
}
