export const COST_SECTION_HREF = {
  estimates: "#cost-estimates",
  charts: "#cost-charts",
} as const;

export type CostPageSection = "estimates" | "charts";

/** Estimates is the default Cost landing tab. */
export function costPageSection(hash: string): CostPageSection {
  const raw = hash.replace(/^#/, "");
  if (raw === "cost-charts") return "charts";
  return "estimates";
}
