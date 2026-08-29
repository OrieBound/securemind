import { describe, expect, it } from "vitest";
import {
  DEFAULT_INSIGHTS_TAB_ORDER,
  normalizeInsightsTabOrder,
  reorderInsightsTab,
} from "@/components/app/insights-nav";

describe("normalizeInsightsTabOrder", () => {
  it("keeps a valid custom order", () => {
    expect(normalizeInsightsTabOrder(["context", "savings", "security"])).toEqual([
      "context",
      "savings",
      "security",
    ]);
  });

  it("fills missing tabs and drops unknowns", () => {
    expect(normalizeInsightsTabOrder(["savings", "nope", "savings"])).toEqual([
      "savings",
      "context",
      "security",
    ]);
  });

  it("defaults to Models first", () => {
    expect(DEFAULT_INSIGHTS_TAB_ORDER[0]).toBe("context");
  });

  it("falls back to default for garbage", () => {
    expect(normalizeInsightsTabOrder(null)).toEqual([...DEFAULT_INSIGHTS_TAB_ORDER]);
    expect(normalizeInsightsTabOrder("security")).toEqual([...DEFAULT_INSIGHTS_TAB_ORDER]);
  });
});

describe("reorderInsightsTab", () => {
  const base = ["security", "context", "savings"] as const;

  it("moves a tab after another via insert-before index", () => {
    // Drop security after context → insert before index 2
    expect(reorderInsightsTab([...base], "security", 2)).toEqual([
      "context",
      "security",
      "savings",
    ]);
  });

  it("moves a tab to the end", () => {
    expect(reorderInsightsTab([...base], "security", 3)).toEqual([
      "context",
      "savings",
      "security",
    ]);
  });

  it("no-ops when index leaves the tab in place", () => {
    expect(reorderInsightsTab([...base], "context", 1)).toEqual([...base]);
    expect(reorderInsightsTab([...base], "context", 2)).toEqual([...base]);
  });
});
