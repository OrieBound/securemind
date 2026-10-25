/**
 * Limits on untrusted uploads, applied before a parser sees the file.
 *
 * - Zip containers (docx, xlsx) are checked from their central directory (total unpacked size,
 *   expansion ratio, entry count), then each entry is inflated with a hard cap so a file that lies
 *   about its sizes is caught too. A "zip bomb" is refused before mammoth or exceljs runs.
 * - Extraction gets a time limit. Parsers that block the event loop cannot be interrupted, so
 *   this stops a request from hanging on slow async work; the size checks are the real bound.
 * - Per-user quotas: uploads in the last 24 hours and total stored bytes.
 *
 * Limits can be raised with environment variables on a larger install.
 */

import { inflateRawSync } from "node:zlib";

export class UploadRejected extends Error {
  status: number;
  code: string;
  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = "UploadRejected";
    this.status = status;
    this.code = code;
  }
}

function envNumber(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function uploadLimits() {
  return {
    maxUnpackedBytes: envNumber("MAX_UNPACKED_MB", 100) * 1024 * 1024,
    maxZipRatio: envNumber("MAX_ZIP_RATIO", 100),
    maxZipEntries: envNumber("MAX_ZIP_ENTRIES", 5000),
    maxUploadsPerDay: envNumber("MAX_UPLOADS_PER_DAY", 200),
    maxStoredBytes: envNumber("MAX_STORAGE_MB_PER_USER", 1024) * 1024 * 1024,
    extractTimeoutMs: envNumber("EXTRACT_TIMEOUT_MS", 60_000),
  };
}

export function isZip(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
}

/**
 * Read the zip's central directory and refuse archives that unpack too large, expand too much,
 * hold too many entries, use ZIP64 (not needed for files under the upload limit), or are malformed.
 */
export function assertSafeZip(buffer: Buffer, limits = uploadLimits()): void {
  const EOCD = 0x06054b50;
  const CEN = 0x02014b50;
  const minEocd = 22;
  let eocd = -1;
  for (let i = buffer.length - minEocd; i >= Math.max(0, buffer.length - minEocd - 0xffff); i--) {
    if (buffer.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new UploadRejected("This file is not a valid document archive.", 422, "BAD_ARCHIVE");

  const entries = buffer.readUInt16LE(eocd + 10);
  const cdSize = buffer.readUInt32LE(eocd + 12);
  const cdOffset = buffer.readUInt32LE(eocd + 16);
  if (entries === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) {
    throw new UploadRejected("Large-archive (ZIP64) documents are not accepted.", 422, "BAD_ARCHIVE");
  }
  if (entries > limits.maxZipEntries) {
    throw new UploadRejected("This document contains too many parts to process.", 413, "ARCHIVE_TOO_LARGE");
  }
  if (cdOffset + cdSize > buffer.length) {
    throw new UploadRejected("This file is not a valid document archive.", 422, "BAD_ARCHIVE");
  }

  let total = 0;
  let p = cdOffset;
  for (let n = 0; n < entries; n++) {
    if (p + 46 > buffer.length || buffer.readUInt32LE(p) !== CEN) {
      throw new UploadRejected("This file is not a valid document archive.", 422, "BAD_ARCHIVE");
    }
    const uncompressed = buffer.readUInt32LE(p + 24);
    if (uncompressed === 0xffffffff) {
      throw new UploadRejected("Large-archive (ZIP64) documents are not accepted.", 422, "BAD_ARCHIVE");
    }
    total += uncompressed;
    if (total > limits.maxUnpackedBytes) {
      throw new UploadRejected("This document unpacks to more than the size limit.", 413, "ARCHIVE_TOO_LARGE");
    }
    p += 46 + buffer.readUInt16LE(p + 28) + buffer.readUInt16LE(p + 30) + buffer.readUInt16LE(p + 32);
  }
  if (buffer.length > 0 && total / buffer.length > limits.maxZipRatio) {
    throw new UploadRejected("This document expands too much to process safely.", 413, "ARCHIVE_TOO_LARGE");
  }

  assertRealUnpackedSize(buffer, cdOffset, entries, limits.maxUnpackedBytes);
}

/**
 * The sizes above are what the archive says about itself, and a crafted file can lie. Inflate each
 * entry with a hard output cap so the real unpacked total is bounded too, before mammoth or exceljs
 * inflates it without one. Peak memory is at most the remaining budget for one entry.
 */
function assertRealUnpackedSize(buffer: Buffer, cdOffset: number, entries: number, maxUnpackedBytes: number): void {
  const LOC = 0x04034b50;
  const bad = () => new UploadRejected("This file is not a valid document archive.", 422, "BAD_ARCHIVE");
  const tooLarge = () => new UploadRejected("This document unpacks to more than the size limit.", 413, "ARCHIVE_TOO_LARGE");

  let total = 0;
  let p = cdOffset;
  for (let n = 0; n < entries; n++) {
    const method = buffer.readUInt16LE(p + 10);
    const compressed = buffer.readUInt32LE(p + 20);
    const declared = buffer.readUInt32LE(p + 24);
    const local = buffer.readUInt32LE(p + 42);
    p += 46 + buffer.readUInt16LE(p + 28) + buffer.readUInt16LE(p + 30) + buffer.readUInt16LE(p + 32);

    if (local + 30 > buffer.length || buffer.readUInt32LE(local) !== LOC) throw bad();
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    if (start + compressed > buffer.length) throw bad();
    const data = buffer.subarray(start, start + compressed);

    const budget = maxUnpackedBytes - total;
    let actual: number;
    if (method === 0) {
      actual = data.length;
    } else if (method === 8) {
      try {
        actual = inflateRawSync(data, { maxOutputLength: Math.max(1, budget) }).length;
      } catch (err) {
        if (err instanceof RangeError || (err as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") throw tooLarge();
        throw bad();
      }
    } else {
      // Office documents use stored or deflate only.
      throw bad();
    }
    // An entry that unpacks larger than it claims is a crafted archive, whatever its size.
    if (actual > declared) throw tooLarge();
    total += actual;
    if (total > maxUnpackedBytes) throw tooLarge();
  }
}
