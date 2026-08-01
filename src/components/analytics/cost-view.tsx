"use client";

import { useEffect, useState } from "react";
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
import { AnalyticsShell, rangeLabelOf, useAnalyticsFilters } from "./analytics-shell";
import { ChartFrame } from "./chart-frame";
import { KpiCard } from "./kpi-card";
import { fetchAnalyticsJson, fmtUsd, shortModel } from "@/lib/analytics/client";

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
};

type Props = { workspaces: WorkspaceOpt[] };

export function CostAnalyticsView({ workspaces }: Props) {
  const { range, setRange, workspaceId, setWorkspaceId } = useAnalyticsFilters("30d");
  const [data, setData] = useState<CostPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchAnalyticsJson<CostPayload>("cost", { range, workspaceId })
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

  return (
    <AnalyticsShell
      active="cost"
      title="Estimated AI inference cost"
      subtitle="Groq list-price estimates from recorded token usage. Not complete AWS, infrastructure, or organizational cost."
      workspaces={workspaces}
      range={range}
      workspaceId={workspaceId}
      onRangeChange={setRange}
      onWorkspaceChange={setWorkspaceId}
    >
      <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs text-amber-100/70">
        {disclaimer ?? "Estimates only."}
        {data && (
          <span className="text-white/35">
            {" "}
            Pricing {data.pricing.version} (effective {data.pricing.effective}).
            {data.kpis.unpricedRequests > 0 &&
              ` ${data.kpis.unpricedRequests} request(s) had no billable token usage (e.g. Ollama).`}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <KpiCard label="Estimated period cost" value={loading ? "…" : fmtUsd(data?.kpis.estimatedCostUsd)} />
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

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <ChartFrame
          title="Estimated cost over time"
          interpretation="Daily estimated inference spend from recorded Groq usage."
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
              <CartesianGrid stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="date" tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 11 }} />
              <YAxis tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 11 }} />
              <Tooltip
                contentStyle={{ background: "#111827", border: "1px solid rgba(255,255,255,0.1)" }}
                formatter={(v) => fmtUsd(typeof v === "number" ? v : Number(v))}
              />
              <Line type="monotone" dataKey="costUsd" stroke="#fbbf24" strokeWidth={2} dot={false} name="Est. USD" />
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
              <CartesianGrid stroke="rgba(255,255,255,0.06)" horizontal={false} />
              <XAxis type="number" tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 11 }} />
              <YAxis type="category" dataKey="label" width={110} tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 11 }} />
              <Tooltip
                contentStyle={{ background: "#111827", border: "1px solid rgba(255,255,255,0.1)" }}
                formatter={(v) => fmtUsd(typeof v === "number" ? v : Number(v))}
              />
              <Bar dataKey="costUsd" fill="#fbbf24" name="Est. USD" />
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
              <CartesianGrid stroke="rgba(255,255,255,0.06)" horizontal={false} />
              <XAxis type="number" tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 11 }} />
              <YAxis type="category" dataKey="name" width={140} tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 11 }} />
              <Tooltip
                contentStyle={{ background: "#111827", border: "1px solid rgba(255,255,255,0.1)" }}
                formatter={(v) => fmtUsd(typeof v === "number" ? v : Number(v))}
              />
              <Bar dataKey="costUsd" fill="#a78bfa" name="Est. USD" />
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
              <CartesianGrid stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="label" tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 11 }} />
              <YAxis tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 11 }} />
              <Tooltip
                contentStyle={{ background: "#111827", border: "1px solid rgba(255,255,255,0.1)" }}
                formatter={(v) => fmtUsd(typeof v === "number" ? v : Number(v))}
              />
              <Bar dataKey="costUsd" fill="#34d399" name="Est. USD" />
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
            <CartesianGrid stroke="rgba(255,255,255,0.06)" />
            <XAxis dataKey="label" tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 11 }} />
            <YAxis tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 11 }} />
            <Tooltip
              contentStyle={{ background: "#111827", border: "1px solid rgba(255,255,255,0.1)" }}
              formatter={(v) => fmtUsd(typeof v === "number" ? v : Number(v))}
            />
            <Legend />
            <Bar dataKey="costUsd" fill="#f472b6" name="Est. USD" />
          </BarChart>
        </ResponsiveContainer>
      </ChartFrame>
    </AnalyticsShell>
  );
}
