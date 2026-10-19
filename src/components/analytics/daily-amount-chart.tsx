"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ChartTheme } from "@/lib/analytics/chart-theme";
import { prefersDailyColumns } from "@/lib/analytics/chart-shape";
import { tooltipStyle } from "./use-chart-theme";

type Row = Record<string, string | number | null | undefined>;

type Props = {
  data: Row[];
  dataKey: string;
  name: string;
  color: string;
  chart: ChartTheme;
  formatValue?: (value: number) => string;
};

/** Columns for a short daily series. A straight line with a dot per day after that. */
export function DailyAmountChart({ data, dataKey, name, color, chart, formatValue }: Props) {
  const tick = { fill: chart.tick, fontSize: 11 };
  const columns = prefersDailyColumns(data.length);
  const yTickFormatter = (value: number) =>
    formatValue ? formatValue(value) : value.toLocaleString();

  const tooltip = (
    <Tooltip
      contentStyle={tooltipStyle(chart)}
      formatter={(value) => {
        const n = typeof value === "number" ? value : Number(value);
        return formatValue ? formatValue(n) : n.toLocaleString();
      }}
    />
  );

  if (columns) {
    return (
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data}>
          <CartesianGrid stroke={chart.grid} vertical={false} />
          <XAxis dataKey="date" tick={tick} />
          <YAxis
            tick={tick}
            tickFormatter={yTickFormatter}
            allowDecimals={Boolean(formatValue)}
            width={56}
          />
          {tooltip}
          <Bar dataKey={dataKey} fill={color} name={name} maxBarSize={48} />
        </BarChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data}>
        <CartesianGrid stroke={chart.grid} vertical={false} />
        <XAxis dataKey="date" tick={tick} />
        <YAxis
          tick={tick}
          tickFormatter={yTickFormatter}
          allowDecimals={Boolean(formatValue)}
          width={56}
        />
        {tooltip}
        <Line
          type="linear"
          dataKey={dataKey}
          stroke={color}
          strokeWidth={2}
          dot={{ r: 3, fill: color }}
          name={name}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
