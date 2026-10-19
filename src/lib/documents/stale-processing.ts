/**
 * Detect uploads that were interrupted while "processing".
 *
 * Ingest runs after the upload response (locally in the background, on Lambda until the
 * function ends). If the process is restarted or killed part-way, nothing ever moves the
 * document out of "processing": it shows a spinner forever, can never be searched, and the
 * UI offers no Reprocess. The read paths settle such documents as failed instead.
 *
 * Pure and client-safe: no database or server imports.
 */

/** A document still "processing" this long after it started is treated as interrupted. */
export const STALE_PROCESSING_MS = 10 * 60 * 1000;

export const INTERRUPTED_CODE = "INTERRUPTED";
/** Reprocess was asked for, but neither the original file nor any stored text exists. */
export const NO_SOURCE_CODE = "NO_SOURCE";

type TimedDocument = {
  status: string;
  createdAt: Date | string;
  processedAt?: Date | string | null;
};

function asMs(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * When the current processing run began. `processedAt` normally records when a run
 * finished, so it only counts here if it is later than creation, which is what a
 * Reprocess click sets. A first-time upload starts at `createdAt`.
 */
export function processingStartedAtMs(doc: TimedDocument): number {
  const created = asMs(doc.createdAt) ?? 0;
  const marked = asMs(doc.processedAt);
  return marked != null && marked > created ? marked : created;
}

export function isStaleProcessing(
  doc: TimedDocument,
  now: number = Date.now(),
  staleAfterMs: number = STALE_PROCESSING_MS,
): boolean {
  if (doc.status !== "processing") return false;
  return now - processingStartedAtMs(doc) > staleAfterMs;
}

const MESSAGES: Record<string, string> = {
  [INTERRUPTED_CODE]:
    "Interrupted: processing stopped before this file finished. Choose Reprocess, or delete it and upload it again.",
  [NO_SOURCE_CODE]:
    "Nothing to reprocess: the original file was never saved. Delete this entry and upload the file again.",
};

const SHORT_LABELS: Record<string, string> = {
  [INTERRUPTED_CODE]: "Interrupted",
  [NO_SOURCE_CODE]: "No source file",
};

/** Short badge text for a code, e.g. "Interrupted"; unknown codes are shown as they are. */
export function shortProcessingError(code: string): string {
  return SHORT_LABELS[code] ?? code;
}

/** Plain-language text for an error code we explain, otherwise the code itself. */
export function describeProcessingError(code: string | null | undefined): string | null {
  if (!code) return null;
  return MESSAGES[code] ?? code;
}
