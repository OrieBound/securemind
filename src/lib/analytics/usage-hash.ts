export const USAGE_SECTION_HREF = {
  overview: "#usage-overview",
  charts: "#usage-charts",
} as const;

export type UsagePageSection = "overview" | "charts";

/** Overview is the default Usage landing tab. */
export function usagePageSection(hash: string): UsagePageSection {
  const raw = hash.replace(/^#/, "");
  if (raw === "usage-charts") return "charts";
  return "overview";
}
