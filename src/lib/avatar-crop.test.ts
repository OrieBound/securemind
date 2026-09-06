import { describe, expect, it } from "vitest";
import { clampOffset, coverScale, sourceCropRect } from "./avatar-crop";

describe("avatar crop math", () => {
  it("covers a wide image by height", () => {
    expect(coverScale(800, 400, 200)).toBe(0.5);
  });

  it("keeps a 1× zoomed landscape image from showing empty bands", () => {
    const { offsetX, offsetY } = clampOffset(800, 400, 200, 1, 999, 999);
    expect(offsetX).toBe(100);
    expect(offsetY).toBe(0);
  });

  it("maps the viewport to a square of source pixels", () => {
    const rect = sourceCropRect(800, 400, 200, 1, 0, 0);
    expect(rect.sSize).toBe(400);
    expect(rect.sy).toBe(0);
    expect(rect.sx).toBe(200);
  });
});
