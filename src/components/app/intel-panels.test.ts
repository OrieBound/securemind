import { describe, expect, it } from "vitest";
import { normalizePanelOrder } from "@/components/app/intel-panels";

describe("normalizePanelOrder", () => {
  it("keeps a valid custom order", () => {
    expect(
      normalizePanelOrder(
        ["model", "usage-summary", "complexity"],
        ["usage-summary", "complexity", "model"],
      ),
    ).toEqual(["model", "usage-summary", "complexity"]);
  });

  it("appends new panels and drops unknowns", () => {
    expect(
      normalizePanelOrder(["complexity", "gone"], ["usage-summary", "complexity", "model"]),
    ).toEqual(["complexity", "usage-summary", "model"]);
  });

  it("falls back to definition order", () => {
    expect(normalizePanelOrder(null, ["a", "b"])).toEqual(["a", "b"]);
  });

  it("applies a preferred default order", () => {
    expect(
      normalizePanelOrder(
        ["usage-summary", "model", "complexity", "last-response"],
        ["usage-summary", "complexity", "last-response", "model"],
      ),
    ).toEqual(["usage-summary", "model", "complexity", "last-response"]);
  });
});
