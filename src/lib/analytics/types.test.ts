import { describe, expect, it } from "vitest";
import { resolveDateRange, riskLevelForCategory } from "./types";

describe("riskLevelForCategory", () => {
  it("marks secrets and payment data as critical", () => {
    expect(riskLevelForCategory("secret")).toBe("critical");
    expect(riskLevelForCategory("card number")).toBe("critical");
    expect(riskLevelForCategory("ssn")).toBe("critical");
  });

  it("marks email and phone as high", () => {
    expect(riskLevelForCategory("email")).toBe("high");
    expect(riskLevelForCategory("phone")).toBe("high");
  });
});

describe("resolveDateRange", () => {
  it("returns a from bound for today and open-ended for all", () => {
    const today = resolveDateRange("today");
    expect(today.from).toBeInstanceOf(Date);
    expect(resolveDateRange("all").from).toBeNull();
  });
});
