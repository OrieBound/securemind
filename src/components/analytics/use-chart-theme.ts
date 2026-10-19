"use client";

import { useEffect, useState, type CSSProperties } from "react";
import {
  readChartTheme,
  subscribeTheme,
  type ChartTheme,
} from "@/lib/analytics/chart-theme";

/** Live chart chrome that follows Appearance → Dark/Light. */
export function useChartTheme(): ChartTheme {
  const [theme, setTheme] = useState<ChartTheme>(() => readChartTheme());

  useEffect(() => {
    const sync = () => setTheme(readChartTheme());
    sync();
    return subscribeTheme(sync);
  }, []);

  return theme;
}

export function tooltipStyle(theme: ChartTheme): CSSProperties {
  return {
    background: theme.tooltipBg,
    border: `1px solid ${theme.tooltipBorder}`,
    color: theme.tooltipFg,
    borderRadius: 8,
    fontSize: 12,
  };
}
