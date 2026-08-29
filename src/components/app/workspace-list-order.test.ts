import { describe, expect, it } from "vitest";
import { normalizeIdOrder, reorderIds } from "@/components/app/workspace-list-order";

describe("normalizeIdOrder", () => {
  it("keeps saved order and appends new ids", () => {
    expect(normalizeIdOrder(["b", "a"], ["a", "b", "c"])).toEqual(["b", "a", "c"]);
  });

  it("drops removed ids", () => {
    expect(normalizeIdOrder(["a", "gone", "b"], ["b", "a"])).toEqual(["a", "b"]);
  });
});

describe("reorderIds", () => {
  it("moves an id below another", () => {
    expect(reorderIds(["a", "b", "c"], "a", 2)).toEqual(["b", "a", "c"]);
  });
});
