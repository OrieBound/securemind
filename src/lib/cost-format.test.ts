import { describe, expect, it } from "vitest";
import { formatUsd, formatUsdLabeled } from "./cost-cap-shared";

describe("formatUsd", () => {
  it("rounds to whole cents the usual way", () => {
    expect(formatUsd(1.234)).toBe("$1.23");
    expect(formatUsd(1.235)).toBe("$1.24");
    expect(formatUsd(1.2349)).toBe("$1.23");
    expect(formatUsd(0.005)).toBe("$0.01");
    expect(formatUsd(12)).toBe("$12.00");
  });

  it("does not show a real cost as free", () => {
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(0.0004)).toBe("<$0.01");
    expect(formatUsd(0.0049)).toBe("<$0.01");
  });

  it("handles missing values and labels the currency", () => {
    expect(formatUsd(null)).toBe("$0.00");
    expect(formatUsdLabeled(null)).toBe("Unlimited");
    expect(formatUsdLabeled(2.5)).toBe("$2.50 USD");
  });
});
