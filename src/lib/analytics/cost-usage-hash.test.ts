import { describe, expect, it } from "vitest";
import { costPageSection } from "./cost-hash";
import { usagePageSection } from "./usage-hash";

describe("costPageSection", () => {
  it("defaults to estimates", () => {
    expect(costPageSection("")).toBe("estimates");
    expect(costPageSection("#cost-estimates")).toBe("estimates");
    expect(costPageSection("#detection-policy")).toBe("estimates");
  });

  it("opens charts when requested", () => {
    expect(costPageSection("#cost-charts")).toBe("charts");
    expect(costPageSection("cost-charts")).toBe("charts");
  });
});

describe("usagePageSection", () => {
  it("defaults to overview", () => {
    expect(usagePageSection("")).toBe("overview");
    expect(usagePageSection("#usage-overview")).toBe("overview");
  });

  it("opens charts when requested", () => {
    expect(usagePageSection("#usage-charts")).toBe("charts");
  });
});
