import { describe, expect, it } from "vitest";
import { imageScanLabels, inspectImagePrivacy } from "./image-privacy";

describe("inspectImagePrivacy", () => {
  it("does not claim sanitization from OCR alone", () => {
    const meta = inspectImagePrivacy({
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      mimeType: "image/png",
      filename: "shot.png",
      textExtracted: true,
    });
    expect(meta.textScanned).toBe(true);
    expect(meta.metadataRemoved).toBe(false);
    expect(meta.visualScan).toBe("limited");
    expect(meta.note).toMatch(/not a full image sanitization/i);
    expect(imageScanLabels(meta).some(r => /sanitized/i.test(r.label))).toBe(false);
  });
});
