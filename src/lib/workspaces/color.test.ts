import { describe, expect, it } from "vitest";
import { normalizeWorkspaceColor } from "./color";

describe("normalizeWorkspaceColor", () => {
  it("accepts 6-digit and 3-digit hex", () => {
    expect(normalizeWorkspaceColor("#6366F1")).toBe("#6366f1");
    expect(normalizeWorkspaceColor(" #abc ")).toBe("#aabbcc");
  });

  it("rejects values that are not a color", () => {
    expect(normalizeWorkspaceColor("red")).toBeNull();
    expect(normalizeWorkspaceColor("#6366f1; background: url(x)")).toBeNull();
    expect(normalizeWorkspaceColor("#gggggg")).toBeNull();
  });
});