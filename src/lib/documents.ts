/**
 * SecureMind document processing pipeline (Phase B).
 *
 * Workflow after a file is uploaded:
 *   1. Extract plain text from the file buffer (PDF → pdf-parse, text → UTF-8 decode)
 *   2. Scrub PII (same patterns as chat) — only sanitized text is persisted
 *   3. Split the text into overlapping 1500-char chunks
 *   4. Embed each chunk via nomic-embed-text (Ollama, zero cost, 768 dims)
 *   5. Persist each chunk as a MemoryFragment with category "document"
 *   6. Update Document.status → "ready" and Document.chunkCount
 *
 * Processing runs fire-and-forget from the upload API.
 * The UI polls /api/documents/[id] until status leaves "processing".
 */

import { db } from "@/lib/db";
import { embedText } from "@/lib/models/ollama";
import { DEFAULT_SAFE_TERMS, scrubPII, type ScrubEvent } from "@/lib/pii";
import { MAX_FILE_BYTES } from "@/lib/documents/constants";

export { MAX_FILE_BYTES } from "@/lib/documents/constants";

// ── constants ──────────────────────────────────────────────────────────────────

// Accepted MIME types — also accept "text/*" broadly for code files
export const ACCEPTED_MIME_TYPES = [
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/x-python",
  "text/javascript",
  "text/x-typescript",
  "application/json",
  "application/pdf",
];

// Extension → MIME fallback (browsers sometimes send "application/octet-stream")
export const EXT_TO_MIME: Record<string, string> = {
  txt:  "text/plain",
  md:   "text/markdown",
  csv:  "text/csv",
  json: "application/json",
  pdf:  "application/pdf",
  py:   "text/x-python",
  js:   "text/javascript",
  ts:   "text/x-typescript",
  tsx:  "text/x-typescript",
  jsx:  "text/javascript",
  yaml: "text/plain",
  yml:  "text/plain",
  toml: "text/plain",
  sh:   "text/plain",
  go:   "text/plain",
  rs:   "text/plain",
};

// Chunking settings — optimised for nomic-embed-text (768-dim, max ~512 tokens)
const CHUNK_SIZE    = 1500; // characters ≈ 375 tokens
const CHUNK_OVERLAP = 200;  // characters of context carried forward
const MIN_CHUNK_LEN = 80;   // discard near-empty chunks

// ── PII scrub at ingest ────────────────────────────────────────────────────────

/**
 * Scrub extracted document text before DB persist or embedding.
 *
 * Only the shipped default safe terms apply here. User-defined safe terms are
 * deliberately not accepted from the client — the server must not take
 * suppression instructions from the browser. They move server-side when safe
 * terms become workspace-scoped DB records.
 */
export function scrubDocumentText(raw: string): {
  content: string;
  redactionCount: number;
  scrubEvents: ScrubEvent[];
  hadRedactions: boolean;
} {
  const result = scrubPII(raw.trim(), { safeTerms: DEFAULT_SAFE_TERMS });
  const redactionCount = result.scrubEvents.reduce((sum, e) => sum + e.count, 0);
  return {
    content:        result.sanitized.trim(),
    redactionCount,
    scrubEvents:    result.scrubEvents,
    hadRedactions:  result.hadRedactions,
  };
}

// ── text extraction ────────────────────────────────────────────────────────────

/**
 * Extracts plain text from a file buffer.
 * PDFs use pdf-parse (dynamically imported to avoid Next.js bundling issues).
 * Everything else is decoded as UTF-8.
 */
export async function extractText(buffer: Buffer, mimeType: string): Promise<string> {
  let raw: string;
  if (mimeType === "application/pdf") {
    // pdf-parse v1.x exports a single function directly — listed in serverExternalPackages
    // so Next.js does not try to webpack-bundle it (avoids fs.readdirSync failures).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require("pdf-parse") as (b: Buffer) => Promise<{ text: string }>;
    const data = await pdfParse(buffer);
    raw = data.text;
  } else {
    raw = buffer.toString("utf-8");
  }
  // Postgres UTF-8 rejects null bytes (\x00) and certain non-printable control
  // characters that PDF parsers commonly leave behind. Strip them here so the
  // db.document.create() call never throws error code 22021.
  return raw
    .replace(/\x00/g, "")
    .replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

/**
 * Resolves the MIME type for an uploaded file.
 * Falls back to extension-based lookup when the browser sends "application/octet-stream".
 */
export function resolveMimeType(reported: string, filename: string): string {
  if (reported && reported !== "application/octet-stream") return reported;
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return EXT_TO_MIME[ext] ?? "text/plain";
}

// ── chunking ───────────────────────────────────────────────────────────────────

/**
 * Splits text into overlapping segments for embedding.
 * Prefers natural break points: paragraph > sentence > character count.
 */
export function chunkText(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + CHUNK_SIZE, text.length);

    if (end < text.length) {
      // Prefer paragraph break
      const paraBreak = text.lastIndexOf("\n\n", end);
      if (paraBreak > start + CHUNK_SIZE / 2) {
        end = paraBreak;
      } else {
        // Fall back to sentence break
        const sentBreak = text.lastIndexOf(". ", end);
        if (sentBreak > start + CHUNK_SIZE / 2) {
          end = sentBreak + 1;
        }
      }
    }

    const chunk = text.slice(start, end).trim();
    if (chunk.length >= MIN_CHUNK_LEN) {
      chunks.push(chunk);
    }

    const nextStart = end - CHUNK_OVERLAP;
    if (nextStart <= start) break; // prevent infinite loop on short texts
    start = nextStart;
  }

  return chunks;
}

// ── processing pipeline ────────────────────────────────────────────────────────

/**
 * Fire-and-forget function called after a Document record is created.
 * Chunks the stored text, embeds each chunk via Ollama, and stores
 * MemoryFragment records with pgvector embeddings.
 *
 * Never throws — sets Document.status to "failed" on any error.
 */
export async function processDocument(documentId: string): Promise<void> {
  try {
    const doc = await db.document.findUnique({ where: { id: documentId } });
    if (!doc) {
      console.error(`[documents] processDocument: document ${documentId} not found`);
      return;
    }

    const chunks = chunkText(doc.content);
    let embedded = 0;
    let ollamaDown = false;

    for (const chunk of chunks) {
      try {
        const vector = await embedText(chunk);

        // Create the MemoryFragment record first (gets a Prisma-managed cuid).
        // workspaceId scopes these chunks to the workspace that owns the document.
        const fragment = await db.memoryFragment.create({
          data: {
            userId:      doc.userId,
            workspaceId: doc.workspaceId ?? undefined,
            documentId:  doc.id,
            content:     chunk,
            category:    "document",
          },
          select: { id: true },
        });

        // Attach the vector via raw SQL — pgvector columns are Unsupported in Prisma schema
        await db.$executeRawUnsafe(
          `UPDATE "MemoryFragment" SET embedding = $1::vector WHERE id = $2`,
          `[${vector.join(",")}]`,
          fragment.id,
        );

        embedded++;
      } catch (chunkErr) {
        if (String(chunkErr).includes("Cannot reach Ollama")) ollamaDown = true;
        console.warn(`[documents] chunk ${embedded + 1} embed failed:`, chunkErr);
      }
    }

    // If Ollama isn't running the document text is still fully stored and
    // readable — only semantic search is unavailable. Mark as "ready" so the
    // user sees the document rather than a misleading "Failed" state.
    // Only mark "failed" when something else went wrong (e.g. DB error).
    const finalStatus = embedded > 0 || ollamaDown ? "ready" : "failed";
    await db.document.update({
      where: { id: documentId },
      data:  { status: finalStatus, chunkCount: embedded },
    });

    console.log(
      `[documents] ${doc.name}: ${embedded}/${chunks.length} chunks embedded → ${finalStatus}`,
    );
  } catch (err) {
    console.error("[documents] processDocument failed:", err);
    await db.document
      .update({ where: { id: documentId }, data: { status: "failed" } })
      .catch(() => {});
  }
}
