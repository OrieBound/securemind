import { describe, expect, it } from "vitest";
import { inspectAvatarBytes } from "./avatar-image";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2, 3, 4, 5]);

describe("inspectAvatarBytes", () => {
  it("accepts PNG and JPEG magic bytes", () => {
    expect(inspectAvatarBytes(PNG)).toEqual({ ok: true, contentType: "image/png" });
    expect(inspectAvatarBytes(JPEG)).toEqual({ ok: true, contentType: "image/jpeg" });
  });

  it("rejects SVG, GIF, and empty buffers", () => {
    expect(inspectAvatarBytes(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>")).ok).toBe(false);
    expect(inspectAvatarBytes(Buffer.from("GIF89a")).ok).toBe(false);
    expect(inspectAvatarBytes(Buffer.alloc(0)).ok).toBe(false);
  });

  it("rejects oversized files", () => {
    const huge = Buffer.concat([JPEG, Buffer.alloc(2 * 1024 * 1024)]);
    expect(inspectAvatarBytes(huge).ok).toBe(false);
  });
});
