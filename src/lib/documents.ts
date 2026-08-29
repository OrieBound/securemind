/**
 * SecureMind document processing pipeline (Phase B).
 *
 * Workflow after a file is uploaded:
 *   1. Extract plain text (PDF → pdf-parse, DOCX → mammoth, images → Groq vision / stub, else UTF-8)
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
import { originalExists, readOriginal } from "@/lib/document-storage";
import { embedText } from "@/lib/models/embed";
import { mirrorDocumentChunkToDynamo } from "@/lib/storage/dynamodb-ingest";
import { scrubPII, type ScrubEvent } from "@/lib/pii";
import { sanitizeRetrievedText } from "@/lib/prompt-guard";
import { extractTextFromImage, isFailedExtractContent } from "@/lib/image-extract";
import { inspectImagePrivacy } from "@/lib/image-privacy";
import { resolveIngestScrubOptions } from "@/lib/security-policy";
import { extractCsvSpreadsheet, extractXlsxSpreadsheet } from "@/lib/spreadsheet/parse";
import type { ChunkProvenance, SpreadsheetTable } from "@/lib/spreadsheet/types";

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
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
];

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const XLS_MIME = "application/vnd.ms-excel";

// Extension → MIME fallback (browsers sometimes send "application/octet-stream")
export const EXT_TO_MIME: Record<string, string> = {
  txt:  "text/plain",
  md:   "text/markdown",
  csv:  "text/csv",
  json: "application/json",
  pdf:  "application/pdf",
  docx: DOCX_MIME,
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
  png:  "image/png",
  jpg:  "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif:  "image/gif",
  xlsx: XLSX_MIME,
  xls:  XLS_MIME,
};

export type DocumentChunkDraft = {
  content: string;
  provenance?: ChunkProvenance | null;
};

export type ExtractedDocument = {
  text: string;
  chunks?: DocumentChunkDraft[];
  extractMeta?: Record<string, unknown>;
  tables?: SpreadsheetTable[];
};

export function isAcceptedDocumentType(mimeType: string, filename: string): boolean {
  if (ACCEPTED_MIME_TYPES.includes(mimeType)) return true;
  if (mimeType.startsWith("text/")) return true;
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return Boolean(EXT_TO_MIME[ext]);
}

export function isSpreadsheetMime(mimeType: string, filename: string): boolean {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return (
    mimeType === XLSX_MIME ||
    mimeType === XLS_MIME ||
    mimeType === "text/csv" ||
    ext === "xlsx" ||
    ext === "xls" ||
    ext === "csv"
  );
}

// Chunking settings — optimised for nomic-embed-text (768-dim, max ~512 tokens)
const CHUNK_SIZE    = 1500; // characters ≈ 375 tokens
const CHUNK_OVERLAP = 200;  // characters of context carried forward
const MIN_CHUNK_LEN = 80;   // discard near-empty chunks

// ── PII scrub at ingest ────────────────────────────────────────────────────────

/**
 * Scrub extracted document text before DB persist or embedding.
 *
 * Safe terms and sensitivity come from the Admin-owned instance security policy
 * (never from the upload request body). Defaults apply until an Admin sets policy.
 */
export async function scrubDocumentText(raw: string): Promise<{
  content: string;
  redactionCount: number;
  scrubEvents: ScrubEvent[];
  hadRedactions: boolean;
}> {
  const opts = await resolveIngestScrubOptions();
  const result = scrubPII(raw.trim(), opts);
  // Neutralize instruction-shaped content before persist/embed so poisoned
  // documents cannot sit in the vector store waiting to be retrieved.
  const guarded = sanitizeRetrievedText(result.sanitized.trim());
  const redactionCount = result.scrubEvents.reduce((sum, e) => sum + e.count, 0);
  return {
    content:        guarded.text,
    redactionCount,
    scrubEvents:    result.scrubEvents,
    hadRedactions:  result.hadRedactions,
  };
}

// ── text extraction ────────────────────────────────────────────────────────────

export async function extractDocument(
  buffer: Buffer,
  mimeType: string,
  filename = "upload",
): Promise<ExtractedDocument> {
  if (isSpreadsheetMime(mimeType, filename)) {
    const ext = filename.split(".").pop()?.toLowerCase() ?? "";
    if (mimeType === "text/csv" || ext === "csv") {
      const extracted = extractCsvSpreadsheet(buffer, filename);
      return {
        text: extracted.text,
        chunks: extracted.chunks,
        extractMeta: extracted.meta,
        tables: extracted.tables,
      };
    }
    if (ext === "xls" && mimeType === XLS_MIME) {
      throw new Error("Legacy .xls is not supported. Save the workbook as .xlsx or .csv and retry.");
    }
    const extracted = await extractXlsxSpreadsheet(buffer);
    return {
      text: extracted.text,
      chunks: extracted.chunks,
      extractMeta: extracted.meta,
      tables: extracted.tables,
    };
  }

  if (mimeType.startsWith("image/")) {
    const text = await extractTextFromImage(buffer, mimeType, filename);
    return {
      text,
      extractMeta: {
        kind: "image",
        imageScan: inspectImagePrivacy({
          buffer,
          mimeType,
          filename,
          textExtracted: Boolean(text.trim()),
        }),
      },
    };
  }

  const text = await extractText(buffer, mimeType, filename);
  return { text };
}

/**
 * Extracts plain text from a file buffer.
 * Images use Groq vision when available (then scrubbed at ingest).
 * PDFs use pdf-parse; DOCX uses mammoth. Spreadsheets use structured extract.
 * Everything else is decoded as UTF-8.
 */
export async function extractText(
  buffer: Buffer,
  mimeType: string,
  filename = "upload",
): Promise<string> {
  if (isSpreadsheetMime(mimeType, filename)) {
    const extracted = await extractDocument(buffer, mimeType, filename);
    return extracted.text;
  }
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  let raw: string;
  if (mimeType.startsWith("image/") || ["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) {
    return extractTextFromImage(buffer, mimeType, filename);
  }
  const zipMagic = buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
  const pdfMagic = buffer.length >= 5 && buffer.subarray(0, 5).toString("latin1") === "%PDF-";
  // Magic bytes win over a mislabeled MIME so a .docx ZIP cannot reach pdf-parse.
  if (zipMagic || ext === "docx" || mimeType === DOCX_MIME) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mammoth = require("mammoth") as {
      extractRawText: (input: { buffer: Buffer }) => Promise<{ value: string }>;
    };
    const result = await mammoth.extractRawText({ buffer });
    raw = result.value ?? "";
    if (!raw.trim()) {
      throw new Error("No readable text found in this Word document");
    }
  } else if (pdfMagic || ext === "pdf" || mimeType === "application/pdf") {
    // pdf-parse v1.x exports a single function directly — listed in serverExternalPackages
    // so Next.js does not try to webpack-bundle it (avoids fs.readdirSync failures).
    // Use the bundled pdf.js v2 engine; v1.10 rejects many modern PDFs.
    // pdf.js also misreads Node Buffer (pooled readFileSync / Buffer.alloc) as a
    // parameter object and throws "bad XRef entry". Pass a standalone Uint8Array.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require("pdf-parse") as (
      b: Uint8Array,
      opts?: { version?: string },
    ) => Promise<{ text: string }>;
    const data = await pdfParse(Uint8Array.from(buffer), { version: "v2.0.550" });
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
 * Called after a Document record is created.
 * Chunks the stored text, embeds each chunk, and stores MemoryFragment
 * records with pgvector embeddings.
 *
 * On Lambda (or DOCUMENT_INGEST_SYNC=true) callers must await this — work
 * after the HTTP response returns is not reliable. Local Next may background it.
 *
 * Never throws — sets Document.status to "failed" on any error.
 */
export async function processDocument(
  documentId: string,
  preparedChunks?: DocumentChunkDraft[],
): Promise<void> {
  try {
    const doc = await db.document.findUnique({ where: { id: documentId } });
    if (!doc) {
      console.error(`[documents] processDocument: document ${documentId} not found`);
      return;
    }

    if (isFailedExtractContent(doc.content)) {
      await db.document.update({
        where: { id: documentId },
        data: { status: "failed", chunkCount: 0, processingError: "STUB_EXTRACT", processedAt: new Date() },
      });
      return;
    }

    await db.memoryFragment.deleteMany({ where: { documentId } });

    let drafts: DocumentChunkDraft[] = preparedChunks?.length
      ? preparedChunks
      : chunkText(doc.content).map(content => ({ content }));

    if ((!preparedChunks || preparedChunks.length === 0) && originalExists(doc.storageKey) && isSpreadsheetMime(doc.mimeType, doc.name)) {
      try {
        const original = await readOriginal(doc.storageKey!);
        const extracted = await extractDocument(original, doc.mimeType, doc.name);
        if (extracted.chunks?.length) {
          drafts = [];
          for (const chunk of extracted.chunks) {
            const scrubbed = await scrubDocumentText(chunk.content);
            if (scrubbed.content) drafts.push({ content: scrubbed.content, provenance: chunk.provenance });
          }
        }
      } catch (err) {
        console.warn("[documents] structured re-extract failed, using stored text:", err);
      }
    }

    const chunks: DocumentChunkDraft[] = drafts.length > 0
      ? drafts
      : chunkText(doc.content).map(content => ({ content }));
    let embedded = 0;
    let ollamaDown = false;

    for (const chunk of chunks) {
      try {
        const vector = await embedText(chunk.content);

        // Create the MemoryFragment record first (gets a Prisma-managed cuid).
        // workspaceId scopes these chunks to the workspace that owns the document.
        const fragment = await db.memoryFragment.create({
          data: {
            userId:      doc.userId,
            workspaceId: doc.workspaceId ?? undefined,
            documentId:  doc.id,
            content:     chunk.content,
            category:    "document",
            provenance:  chunk.provenance ?? undefined,
          },
          select: { id: true },
        });

        // Attach the vector via raw SQL — pgvector columns are Unsupported in Prisma schema
        await db.$executeRawUnsafe(
          `UPDATE "MemoryFragment" SET embedding = $1::vector WHERE id = $2`,
          `[${vector.join(",")}]`,
          fragment.id,
        );

        await mirrorDocumentChunkToDynamo({
          fragmentId: fragment.id,
          userId: doc.userId,
          workspaceId: doc.workspaceId,
          content: chunk.content,
          embedding: vector,
          documentId: doc.id,
          documentName: doc.name,
          provenance: chunk.provenance ?? null,
        });

        embedded++;
      } catch (chunkErr) {
        const msg = String(chunkErr);
        if (msg.includes("Cannot reach Ollama") || msg.includes("Bedrock embed")) {
          ollamaDown = true;
        }
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
      data:  {
        status: finalStatus,
        chunkCount: embedded,
        processedAt: new Date(),
        processingError: finalStatus === "failed" ? "EMBED_FAILED" : null,
      },
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
