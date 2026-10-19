import { describe, expect, it } from "vitest";
import {
  costCapWarningLevel,
  parseMonthlyCostCapInput,
} from "./cost-cap-shared";

describe("parseMonthlyCostCapInput", () => {
  it("accepts presets and unlimited", () => {
    expect(parseMonthlyCostCapInput(10)).toEqual({ ok: true, value: 10 });
    expect(parseMonthlyCostCapInput("unlimited")).toEqual({ ok: true, value: null });
    expect(parseMonthlyCostCapInput(null)).toEqual({ ok: true, value: null });
  });

  it("rejects zero, negatives, and excess decimals", () => {
    expect(parseMonthlyCostCapInput(0).ok).toBe(false);
    expect(parseMonthlyCostCapInput(-1).ok).toBe(false);
    expect(parseMonthlyCostCapInput(1.234).ok).toBe(false);
  });
});

describe("costCapWarningLevel", () => {
  it("returns none / warn50 / warn80 / blocked", () => {
    expect(costCapWarningLevel(10, 4)).toBe("none");
    expect(costCapWarningLevel(10, 5)).toBe("warn50");
    expect(costCapWarningLevel(10, 8)).toBe("warn80");
    expect(costCapWarningLevel(10, 10)).toBe("blocked");
    expect(costCapWarningLevel(null, 999)).toBe("none");
  });
});
