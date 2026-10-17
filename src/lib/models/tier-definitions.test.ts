import { describe, expect, it } from "vitest";
import { TIER_NAMES } from "./router";
import {
  TIER_DEFINITIONS,
  TIER_ORDER,
  maxTier,
  minTier,
  stepDown,
  tierGuideForPrompt,
  tierRank,
} from "./tier-definitions";

describe("tier definitions", () => {
  it("define exactly the tiers the router can run, so the two never drift", () => {
    expect([...TIER_ORDER].sort()).toEqual([...TIER_NAMES].sort());
    expect(Object.keys(TIER_DEFINITIONS).sort()).toEqual([...TIER_NAMES].sort());
  });

  it("give every tier a plain sentence and examples", () => {
    for (const tier of TIER_ORDER) {
      const d = TIER_DEFINITIONS[tier];
      expect(d.tier).toBe(tier);
      expect(d.summary.length).toBeGreaterThan(20);
      expect(d.examples.length).toBeGreaterThan(0);
    }
  });

  it("describe tiers without promising more than the code does", () => {
    const text = Object.values(TIER_DEFINITIONS).map(d => d.summary).join(" ").toLowerCase();
    expect(text).not.toMatch(/guarantee|always|never wrong/);
  });

  it("list the tiers most capable first in the prompt guide", () => {
    const lines = tierGuideForPrompt().split("\n");
    expect(lines).toHaveLength(TIER_ORDER.length);
    expect(lines[0].startsWith("Max")).toBe(true);
    expect(lines.at(-1)?.startsWith("Micro")).toBe(true);
  });

  it("rank, max and min agree", () => {
    expect(tierRank("Micro")).toBe(0);
    expect(tierRank("Max")).toBe(4);
    expect(tierRank("not a tier")).toBe(tierRank("Standard"));
    expect(maxTier("Light", "Plus")).toBe("Plus");
    expect(minTier("Light", "Plus")).toBe("Light");
    expect(stepDown("Max", 2)).toBe("Standard");
    expect(stepDown("Light", 9)).toBe("Micro");
  });
});
