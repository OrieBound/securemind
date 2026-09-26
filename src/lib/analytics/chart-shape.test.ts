import { describe, expect, it } from "vitest";
import {
  bucketLatencyMs,
  groundingStack,
  orderTierCounts,
  prefersDailyColumns,
} from "./chart-shape";

describe("prefersDailyColumns", () => {
  it("uses columns for a short run of days", () => {
    expect(prefersDailyColumns(3)).toBe(true);
    expect(prefersDailyColumns(13)).toBe(true);
  });

  it("uses a line once there are enough days to show a trend", () => {
    expect(prefersDailyColumns(14)).toBe(false);
  });
});

describe("bucketLatencyMs", () => {
  it("counts response times into fixed buckets", () => {
    const buckets = bucketLatencyMs([200, 1500, 8000, 20000, 90000, 180000, Number.NaN]);
    expect(buckets.map(b => b.count)).toEqual([1, 1, 1, 1, 1, 1]);
  });
});

describe("orderTierCounts", () => {
  it("keeps Max through Micro even when a tier is unused", () => {
    expect(orderTierCounts([
      { tier: "Micro", count: 6 },
      { tier: "High", count: 1 },
      { tier: "Fast", count: 2 },
    ])).toEqual([
      { tier: "Max", count: 1 },
      { tier: "Plus", count: 0 },
      { tier: "Standard", count: 0 },
      { tier: "Light", count: 2 },
      { tier: "Micro", count: 6 },
    ]);
  });
});

describe("groundingStack", () => {
  it("stacks cited outcomes and holds social turns aside", () => {
    const stack = groundingStack([
      { status: "uncited", count: 8 },
      { status: "not_applicable", count: 11 },
      { status: "grounded", count: 0 },
    ]);
    expect(stack.series).toEqual(["Uncited"]);
    expect(stack.point.Uncited).toBe(8);
    expect(stack.notApplicable).toBe(11);
  });
});
