import { describe, expect, it } from "vitest";
import { vendorMenuPhrase } from "./model-inventory";

describe("vendorMenuPhrase", () => {
  it("does not call a full catalog in menus until tests succeed", () => {
    expect(vendorMenuPhrase(18, 0)).toBe("18 listed · enable to use");
    expect(vendorMenuPhrase(18, 3)).toBe("3 of 18 in menus");
  });

  it("says in menus once every listed model can run", () => {
    expect(vendorMenuPhrase(18, 18)).toBe("18 in menus");
    expect(vendorMenuPhrase(0, 0)).toBeNull();
  });
});
