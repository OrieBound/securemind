/**
 * Chart chrome colours derived from the live CSS theme tokens.
 * Call inside components (or effects) so light/dark switches update series chrome.
 */

export type ChartTheme = {
  grid: string;
  tick: string;
  tooltipBg: string;
  tooltipBorder: string;
  tooltipFg: string;
  series: string[];
};

function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** Read current theme chart tokens. Prefer calling after mount / theme change. */
export function readChartTheme(): ChartTheme {
  return {
    grid: cssVar("--border", "#D4D0CA"),
    tick: cssVar("--muted-foreground", "#687181"),
    tooltipBg: cssVar("--popover", "#FFFFFF"),
    tooltipBorder: cssVar("--border-strong", "#B9B4AD"),
    tooltipFg: cssVar("--popover-foreground", "#171923"),
    series: [
      cssVar("--chart-1", "#6547E8"),
      cssVar("--chart-2", "#0F766E"),
      cssVar("--chart-3", "#1D5BBF"),
      cssVar("--chart-4", "#1F7A4D"),
      cssVar("--chart-5", "#B45309"),
      // Severity / extra — keep meaning across themes
      cssVar("--destructive", "#C0392B"),
    ],
  };
}

/** Hook-friendly: subscribe to theme attribute changes on <html>. */
export function subscribeTheme(cb: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "data-theme"],
  });
  return () => obs.disconnect();
}
