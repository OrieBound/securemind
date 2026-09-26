/**
 * Chart-shape rules shared by Usage, Cost, and Security.
 * Short daily counts are columns. A line is for a longer run of days, with a
 * dot on each day and no curve between them.
 */

export const SHORT_DAILY_SERIES = 14;

export const USAGE_TIER_ORDER = ["Max", "Plus", "Standard", "Light", "Micro"] as const;

const LATENCY_BOUNDS: { label: string; max: number }[] = [
  { label: "<1s", max: 1_000 },
  { label: "1–3s", max: 3_000 },
  { label: "3–10s", max: 10_000 },
  { label: "10–30s", max: 30_000 },
  { label: "30s–2m", max: 120_000 },
  { label: ">2m", max: Number.POSITIVE_INFINITY },
];

export function prefersDailyColumns(pointCount: number): boolean {
  return pointCount < SHORT_DAILY_SERIES;
}

export function fmtCount(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString();
}

/** Milliseconds for short calls, whole seconds once a reply takes 10s or more. */
export function fmtLatency(ms: number | null | undefined): string {
  if (ms == null || Number.isNaN(ms)) return "—";
  if (ms >= 10_000) return `${Math.round(ms / 1000)} s`;
  if (ms >= 1_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms)} ms`;
}

export type LatencyBucket = { label: string; count: number };

export function bucketLatencyMs(samples: number[]): LatencyBucket[] {
  const buckets = LATENCY_BOUNDS.map(b => ({ label: b.label, count: 0 }));
  for (const ms of samples) {
    if (!Number.isFinite(ms) || ms < 0) continue;
    const index = LATENCY_BOUNDS.findIndex(b => ms < b.max);
    buckets[index === -1 ? buckets.length - 1 : index].count += 1;
  }
  return buckets;
}

/** Max → Micro, with retired High/Fast names folded in. Zero tiers stay so the order is readable. */
export function orderTierCounts(
  rows: { tier: string; count: number }[],
): { tier: string; count: number }[] {
  const map = new Map<string, number>();
  for (const row of rows) {
    const tier = row.tier === "High" ? "Max" : row.tier === "Fast" ? "Light" : row.tier;
    map.set(tier, (map.get(tier) ?? 0) + row.count);
  }
  const known = USAGE_TIER_ORDER.map(tier => ({ tier, count: map.get(tier) ?? 0 }));
  const extras = [...map.entries()]
    .filter(([tier]) => !(USAGE_TIER_ORDER as readonly string[]).includes(tier))
    .map(([tier, count]) => ({ tier, count }))
    .filter(row => row.count > 0);
  const ordered = [...known, ...extras];
  if (ordered.every(row => row.count === 0)) return [];
  return ordered;
}

const CITED_GROUNDING = [
  { status: "grounded", label: "Grounded" },
  { status: "partial", label: "Partial" },
  { status: "uncited", label: "Uncited" },
  { status: "insufficient_evidence", label: "Insufficient" },
  { status: "invalid", label: "Invalid" },
  { status: "declined", label: "Declined" },
] as const;

export type GroundingStack = {
  point: Record<string, string | number>;
  series: string[];
  notApplicable: number;
};

/** Part-to-whole for answers that were asked to cite. Social turns stay out of the stack. */
export function groundingStack(
  rows: { status: string; count: number }[],
): GroundingStack {
  const map = new Map(rows.map(row => [row.status, row.count]));
  const point: Record<string, string | number> = { label: "This period" };
  const series: string[] = [];
  for (const item of CITED_GROUNDING) {
    const count = map.get(item.status) ?? 0;
    if (count <= 0) continue;
    point[item.label] = count;
    series.push(item.label);
  }
  const notApplicable = (map.get("not_applicable") ?? 0) + (map.get("n/a") ?? 0);
  return { point, series, notApplicable };
}
