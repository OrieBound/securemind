import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/documents/persist", () => ({
  listPersistedDocuments: vi.fn(async () => []),
}));

import JSZip from "jszip";
import { assertSafeZip, assertUploadQuota, UploadRejected, uploadLimits, withTimeout } from "@/lib/documents/upload-guard";
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

/** A real deflated zip, built the way Office files are. */
async function realZip(files: Record<string, string | Uint8Array>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, data] of Object.entries(files)) zip.file(name, data);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

/** Rewrite every size the archive declares (central directory and local headers). */
function lieAboutSizes(buf: Buffer, declared: number): Buffer {
  const out = Buffer.from(buf);
  for (let i = 0; i + 4 <= out.length; i++) {
    const sig = out.readUInt32LE(i);
    if (sig === 0x02014b50) out.writeUInt32LE(declared, i + 24);
    if (sig === 0x04034b50) out.writeUInt32LE(declared, i + 22);
  }
  return out;
}

describe("assertSafeZip on real archives", () => {
  it("accepts an ordinary deflated document", async () => {
    const buf = await realZip({ "word/document.xml": "<w:document>hello</w:document>".repeat(200), "[Content_Types].xml": "<Types/>" });
    expect(() => assertSafeZip(buf)).not.toThrow();
  });

  it("refuses an archive that unpacks far larger than it claims", async () => {
    const bomb = await realZip({ "word/document.xml": new Uint8Array(50 * 1024 * 1024) });
    // Claim a tiny size so the declared-size and ratio checks pass; only real inflation catches it.
    expect(() => assertSafeZip(lieAboutSizes(bomb, 1000))).toThrow(UploadRejected);
  });

  it("stops inflating at the size limit even when the archive is honest", async () => {
    const big = await realZip({ "a.xml": new Uint8Array(3 * 1024 * 1024) });
    const limits = { ...uploadLimits(), maxUnpackedBytes: 1024 * 1024, maxZipRatio: 1e9 };
    expect(() => assertSafeZip(lieAboutSizes(big, 512 * 1024), limits)).toThrow(/size limit/);
  });

  it("refuses compression methods Office files never use", async () => {
    const buf = Buffer.from(await realZip({ "a.xml": "x".repeat(1000) }));
    for (let i = 0; i + 4 <= buf.length; i++) {
      if (buf.readUInt32LE(i) === 0x02014b50) buf.writeUInt16LE(14, i + 10); // LZMA
    }
    expect(() => assertSafeZip(buf)).toThrow(/not a valid document/);
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
