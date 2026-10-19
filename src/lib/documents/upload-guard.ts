/**
 * Limits on untrusted uploads, applied before a parser sees the file.
 *
 * - Zip containers (docx, xlsx) are checked from their central directory: total unpacked size,
 *   expansion ratio and entry count. A "zip bomb" is refused before mammoth or exceljs runs.
 * - Extraction gets a time limit. Parsers that block the event loop cannot be interrupted, so
 *   this stops a request from hanging on slow async work; the size checks are the real bound.
 * - Per-user quotas: uploads in the last 24 hours and total stored bytes.
 *
 * Limits can be raised with environment variables on a larger install.
 */

import { listPersistedDocuments } from "@/lib/documents/persist";

import { UploadRejected, uploadLimits } from "@/lib/documents/zip-guard";

export { assertSafeZip, isZip, UploadRejected, uploadLimits } from "@/lib/documents/zip-guard";

/** Refuse when the caller is over the daily upload count or total stored bytes. */
export async function assertUploadQuota(userId: string, incomingBytes: number, limits = uploadLimits()): Promise<void> {
  const docs = await listPersistedDocuments(userId, null);
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  let stored = 0;
  let recent = 0;
  for (const d of docs) {
    stored += d.sizeBytes || 0;
    const created = new Date(d.createdAt).getTime();
    if (created >= dayAgo) recent++;
  }
  if (recent >= limits.maxUploadsPerDay) {
    throw new UploadRejected("Daily upload limit reached. Try again tomorrow.", 429, "UPLOAD_RATE");
  }
  if (stored + incomingBytes > limits.maxStoredBytes) {
    throw new UploadRejected("Storage limit reached. Delete some documents first.", 413, "STORAGE_QUOTA");
  }
}

export async function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new UploadRejected(message, 504, "EXTRACT_TIMEOUT")), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
