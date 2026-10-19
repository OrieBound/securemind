import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/documents/persist", () => ({
  listPersistedDocuments: vi.fn(async () => []),
}));

import { assertSafeZip, assertUploadQuota, UploadRejected, withTimeout } from "@/lib/documents/upload-guard";
import { listPersistedDocuments } from "@/lib/documents/persist";

/** Minimal stored zip with entries of the given claimed uncompressed sizes. */
function zipWith(uncompressed: number[], realSize = 200): Buffer {
  const cen: Buffer[] = [];
  for (const [i, size] of uncompressed.entries()) {
    const name = Buffer.from(`f${i}.xml`);
    const h = Buffer.alloc(46);
    h.writeUInt32LE(0x02014b50, 0);
    h.writeUInt32LE(size, 24);
    h.writeUInt16LE(name.length, 28);
    cen.push(Buffer.concat([h, name]));
  }
  const cd = Buffer.concat(cen);
  const body = Buffer.alloc(realSize);
  body.writeUInt32LE(0x04034b50, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(uncompressed.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(body.length, 16);
  return Buffer.concat([body, cd, eocd]);
}

describe("assertSafeZip", () => {
  it("accepts a normal archive", () => {
    expect(() => assertSafeZip(zipWith([1000, 2000], 4000))).not.toThrow();
  });
  it("refuses an archive that unpacks past the limit", () => {
    expect(() => assertSafeZip(zipWith([200 * 1024 * 1024], 10_000_000))).toThrow(UploadRejected);
  });
  it("refuses an extreme expansion ratio", () => {
    expect(() => assertSafeZip(zipWith([5 * 1024 * 1024], 1000))).toThrow(/expands too much/);
  });
  it("refuses ZIP64 markers and a truncated directory", () => {
    expect(() => assertSafeZip(zipWith([0xffffffff]))).toThrow(/ZIP64/);
    expect(() => assertSafeZip(zipWith([100]).subarray(0, 220))).toThrow(UploadRejected);
  });
});

describe("assertUploadQuota", () => {
  it("refuses past the daily count and the storage cap", async () => {
    const now = new Date();
    vi.mocked(listPersistedDocuments).mockResolvedValueOnce(
      Array.from({ length: 200 }, () => ({ sizeBytes: 1, createdAt: now })) as never,
    );
    await expect(assertUploadQuota("u1", 10)).rejects.toMatchObject({ status: 429 });
    vi.mocked(listPersistedDocuments).mockResolvedValueOnce([
      { sizeBytes: 1024 * 1024 * 1024, createdAt: new Date(0) },
    ] as never);
    await expect(assertUploadQuota("u1", 10)).rejects.toMatchObject({ status: 413 });
  });
});

describe("withTimeout", () => {
  it("rejects slow work", async () => {
    await expect(withTimeout(new Promise(() => {}), 10, "slow")).rejects.toMatchObject({ code: "EXTRACT_TIMEOUT" });
  });
});
