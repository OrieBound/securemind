import { describe, expect, it } from "vitest";
import {
  INTERRUPTED_CODE,
  NO_SOURCE_CODE,
  STALE_PROCESSING_MS,
  describeProcessingError,
  isStaleProcessing,
  processingStartedAtMs,
  shortProcessingError,
} from "./stale-processing";

const NOW = Date.parse("2026-10-17T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms);

describe("isStaleProcessing", () => {
  it("is false for anything that is not processing", () => {
    for (const status of ["ready", "failed"]) {
      expect(isStaleProcessing({ status, createdAt: ago(STALE_PROCESSING_MS * 5) }, NOW)).toBe(false);
    }
  });

  it("is false for a recent upload and true once the window has passed", () => {
    expect(isStaleProcessing({ status: "processing", createdAt: ago(60_000) }, NOW)).toBe(false);
    expect(isStaleProcessing({ status: "processing", createdAt: ago(STALE_PROCESSING_MS) }, NOW)).toBe(false);
    expect(isStaleProcessing({ status: "processing", createdAt: ago(STALE_PROCESSING_MS + 1) }, NOW)).toBe(true);
  });

  it("measures a Reprocess from the click, not from when the document was created", () => {
    const doc = {
      status: "processing",
      createdAt: ago(30 * 24 * 3600_000),
      processedAt: ago(30_000),
    };
    expect(processingStartedAtMs(doc)).toBe(NOW - 30_000);
    expect(isStaleProcessing(doc, NOW)).toBe(false);
  });

  it("ignores a completion time from before this run (processedAt older than createdAt)", () => {
    const doc = { status: "processing", createdAt: ago(60_000), processedAt: ago(3600_000) };
    expect(processingStartedAtMs(doc)).toBe(NOW - 60_000);
  });

  it("accepts ISO strings from the hosted store", () => {
    const doc = { status: "processing", createdAt: ago(STALE_PROCESSING_MS * 2).toISOString() };
    expect(isStaleProcessing(doc, NOW)).toBe(true);
  });

  it("treats an unreadable creation date as old rather than as a crash", () => {
    const doc = { status: "processing", createdAt: "not a date" };
    expect(Number.isFinite(processingStartedAtMs(doc))).toBe(true);
    expect(isStaleProcessing(doc, NOW)).toBe(true);
  });
});

describe("error text", () => {
  it("explains the codes this feature adds and passes others through", () => {
    expect(describeProcessingError(INTERRUPTED_CODE)).toMatch(/Reprocess/);
    expect(describeProcessingError(NO_SOURCE_CODE)).toMatch(/upload the file again/i);
    expect(describeProcessingError("VISION_FAILED")).toBe("VISION_FAILED");
    expect(describeProcessingError(null)).toBeNull();
    expect(shortProcessingError(INTERRUPTED_CODE)).toBe("Interrupted");
    expect(shortProcessingError("EMBED_FAILED")).toBe("EMBED_FAILED");
  });
});
