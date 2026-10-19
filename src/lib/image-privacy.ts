/**
 * Image privacy signals for Knowledge. OCR text is scanned separately.
 * Do not claim an image is "sanitized" from these checks alone.
 */

export type VisualScanState = "unavailable" | "limited" | "completed";

export type ImageScanMeta = {
  textScanned: boolean;
  metadataFound: boolean;
  metadataRemoved: boolean;
  visualScan: VisualScanState;
  filenameScanned: boolean;
  note: string;
};

function jpegHasExif(buffer: Buffer): boolean {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return false;
  let i = 2;
  while (i + 4 < buffer.length && buffer[i] === 0xff) {
    const marker = buffer[i + 1]!;
    if (marker === 0xda || marker === 0xd9) break;
    const size = (buffer[i + 2]! << 8) + buffer[i + 3]!;
    if (marker === 0xe1) {
      const start = i + 4;
      const head = buffer.subarray(start, start + 6).toString("ascii");
      if (head.startsWith("Exif")) return true;
    }
    i += 2 + size;
  }
  return false;
}

export function inspectImagePrivacy(opts: {
  buffer: Buffer;
  mimeType: string;
  filename: string;
  textExtracted: boolean;
}): ImageScanMeta {
  const metadataFound =
    opts.mimeType === "image/jpeg" || opts.mimeType === "image/jpg"
      ? jpegHasExif(opts.buffer)
      : false;

  return {
    textScanned: opts.textExtracted,
    metadataFound,
    metadataRemoved: false,
    visualScan: opts.textExtracted ? "limited" : "unavailable",
    filenameScanned: true,
    note: opts.textExtracted
      ? "OCR/vision text was scanned. Visual PII detection (faces, IDs, plates) is limited and is not a full image sanitization."
      : "Visual scanning unavailable. Text was not extracted, so this image is not treated as sanitized.",
  };
}

export function imageScanLabels(scan: ImageScanMeta): { label: string; tone: "ok" | "warn" | "muted" }[] {
  const rows: { label: string; tone: "ok" | "warn" | "muted" }[] = [];
  rows.push({
    label: scan.textScanned ? "Text scanned" : "Text not scanned",
    tone: scan.textScanned ? "ok" : "warn",
  });
  rows.push({
    label: scan.metadataRemoved
      ? "Metadata removed"
      : scan.metadataFound
        ? "Metadata present on original"
        : "No EXIF detected",
    tone: scan.metadataRemoved ? "ok" : scan.metadataFound ? "warn" : "muted",
  });
  rows.push({
    label:
      scan.visualScan === "completed"
        ? "Visual scan completed"
        : scan.visualScan === "limited"
          ? "Visual scan limited"
          : "Visual scanning unavailable",
    tone: scan.visualScan === "completed" ? "ok" : "warn",
  });
  return rows;
}
