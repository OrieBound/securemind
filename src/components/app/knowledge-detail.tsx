"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, Shield, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { categoryLabel } from "@/lib/pii";
import { imageScanLabels, type ImageScanMeta } from "@/lib/image-privacy";

export type KnowledgeLibraryFilter = "all" | "documents" | "spreadsheets" | "images";

type ScrubEvent = { category: string; count: number };

export type KnowledgeDocDetail = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  description: string | null;
  status: "processing" | "ready" | "failed";
  chunkCount: number;
  content: string;
  createdAt: string;
  redactionCount?: number;
  scrubEvents?: ScrubEvent[];
  processingError?: string | null;
  hasOriginal?: boolean;
  extractMeta?: {
    kind?: string;
    sheets?: { name: string; headers: string[]; rowCount: number }[];
    imageScan?: ImageScanMeta;
  } | null;
  fragmentTotal?: number;
  fragments: Array<{
    id: string;
    content: string;
    createdAt: string;
    provenance?: { range?: string; sheet?: string; page?: number } | null;
  }>;
};

const CHUNK_PAGE = 8;
const CONTENT_PREVIEW = 800;

export function knowledgeLibraryKind(
  mimeType: string,
): Exclude<KnowledgeLibraryFilter, "all"> {
  if (mimeType.startsWith("image/")) return "images";
  if (
    mimeType === "text/csv" ||
    mimeType.includes("spreadsheet") ||
    mimeType === "application/vnd.ms-excel"
  ) {
    return "spreadsheets";
  }
  return "documents";
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function timeSince(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

function docTypeInfo(mimeType: string): { label: string; cls: string } {
  if (mimeType === "application/pdf") return { label: "PDF", cls: "text-red-400 bg-red-500/10 border-red-500/20" };
  if (mimeType === "text/markdown") return { label: "MD", cls: "text-sky-400 bg-sky-500/10 border-sky-500/20" };
  if (mimeType === "application/json") return { label: "JSON", cls: "text-amber-400 bg-amber-500/10 border-amber-500/20" };
  if (mimeType === "text/csv") return { label: "CSV", cls: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" };
  if (mimeType.includes("spreadsheet") || mimeType === "application/vnd.ms-excel") {
    return { label: "XLSX", cls: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" };
  }
  if (mimeType.includes("wordprocessingml")) {
    return { label: "DOCX", cls: "text-sky-400 bg-sky-500/10 border-sky-500/20" };
  }
  if (mimeType.startsWith("image/")) return { label: "IMG", cls: "text-fuchsia-400 bg-fuchsia-500/10 border-fuchsia-500/20" };
  if (mimeType.startsWith("text/x-")) return { label: "CODE", cls: "text-violet-400 bg-violet-500/10 border-violet-500/20" };
  return { label: "TXT", cls: "text-foreground/40 bg-foreground/5 border-foreground/10" };
}

function formatProcessed(content: string, mimeType: string): string {
  if (mimeType === "application/json") {
    try {
      return JSON.stringify(JSON.parse(content), null, 2);
    } catch {
      return content;
    }
  }
  return content;
}

function statusLabel(doc: KnowledgeDocDetail): { text: string; cls: string; dot: string } {
  if (doc.status === "ready" && doc.chunkCount > 0) {
    return { text: "Indexed", cls: "text-emerald-400", dot: "bg-emerald-400" };
  }
  if (doc.status === "ready") {
    return { text: "Stored · not indexed", cls: "text-amber-400", dot: "bg-amber-400" };
  }
  if (doc.status === "processing") {
    return { text: "Embedding…", cls: "text-yellow-400", dot: "bg-yellow-400 animate-pulse" };
  }
  return {
    text: doc.processingError ? `Failed · ${doc.processingError}` : "Needs attention",
    cls: "text-red-400",
    dot: "bg-red-400",
  };
}

export function KnowledgeDetail({
  doc,
  onBack,
  onDelete,
  onReprocess,
}: {
  doc: KnowledgeDocDetail;
  onBack: () => void;
  onDelete: () => void;
  onReprocess: () => void;
}) {
  const [showFullContent, setShowFullContent] = useState(false);
  const [contentQuery, setContentQuery] = useState("");
  const [chunkPage, setChunkPage] = useState(0);
  const [openChunk, setOpenChunk] = useState<string | null>(null);
  const [pageChunks, setPageChunks] = useState(doc.fragments);
  const [chunkTotal, setChunkTotal] = useState(doc.fragmentTotal ?? doc.fragments.length);
  const [chunksLoading, setChunksLoading] = useState(false);

  const type = docTypeInfo(doc.mimeType);
  const status = statusLabel(doc);
  const isImage = doc.mimeType.startsWith("image/");
  const processed = useMemo(() => formatProcessed(doc.content, doc.mimeType), [doc.content, doc.mimeType]);
  const filtered = useMemo(() => {
    const q = contentQuery.trim().toLowerCase();
    if (!q) return processed;
    const lines = processed.split("\n");
    return lines.filter(line => line.toLowerCase().includes(q)).join("\n");
  }, [processed, contentQuery]);
  const preview = showFullContent ? filtered : filtered.slice(0, CONTENT_PREVIEW);
  const truncated = !showFullContent && filtered.length > CONTENT_PREVIEW;
  const imageScan = doc.extractMeta?.imageScan;
  const scanRows = imageScan ? imageScanLabels(imageScan) : [];
  useEffect(() => {
    setPageChunks(doc.fragments);
    setChunkTotal(doc.fragmentTotal ?? doc.fragments.length);
    setChunkPage(0);
    setOpenChunk(null);
  }, [doc.id, doc.fragments, doc.fragmentTotal]);

  const totalChunkPages = Math.max(1, Math.ceil(chunkTotal / CHUNK_PAGE));

  async function loadChunkPage(p: number) {
    if (p === 0 && doc.fragments.length > 0 && (doc.fragmentTotal ?? doc.fragments.length) === chunkTotal) {
      setPageChunks(doc.fragments);
      setChunkPage(0);
      return;
    }
    setChunksLoading(true);
    try {
      const res = await fetch(`/api/documents/${doc.id}?chunksPage=${p}&chunksLimit=${CHUNK_PAGE}`);
      if (!res.ok) return;
      const data = await res.json() as { fragments?: typeof doc.fragments; fragmentTotal?: number };
      setPageChunks(data.fragments ?? []);
      if (typeof data.fragmentTotal === "number") setChunkTotal(data.fragmentTotal);
      setChunkPage(p);
    } finally {
      setChunksLoading(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-foreground/45 hover:text-foreground/70 transition-colors"
        >
          <ChevronLeft className="size-4" aria-hidden />
          Knowledge
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="flex items-center gap-1.5 text-[0.72rem] text-red-400/60 hover:text-red-400 transition-colors px-2 py-1 rounded-lg hover:bg-red-500/10"
        >
          <Trash2 className="size-3.5" aria-hidden />
          Delete
        </button>
      </div>

      <div className="rounded-2xl bg-foreground/[0.04] border border-foreground/[0.07] p-5 space-y-4">
        <div className="flex items-start gap-3">
          <span className={cn("shrink-0 rounded-lg border px-2.5 py-1 text-[0.65rem] font-bold tracking-wider font-mono", type.cls)}>
            {type.label}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-base font-semibold text-foreground/90 break-all leading-snug">{doc.name}</p>
            {doc.description && (
              <p className="mt-0.5 text-sm text-foreground/45">{doc.description}</p>
            )}
          </div>
        </div>

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[0.72rem]">
          <dt className="text-foreground/35">Size</dt>
          <dd className="text-foreground/70">{fmtBytes(doc.sizeBytes)}</dd>
          <dt className="text-foreground/35">Uploaded</dt>
          <dd className="text-foreground/70">{timeSince(doc.createdAt)}</dd>
          <dt className="text-foreground/35">Processing</dt>
          <dd className={cn("flex items-center gap-1.5", status.cls)}>
            <span className={cn("size-1.5 rounded-full inline-block", status.dot)} />
            {status.text}
          </dd>
          <dt className="text-foreground/35">Indexed chunks</dt>
          <dd className="text-foreground/70">{doc.chunkCount}</dd>
        </dl>

        <div className="flex flex-wrap gap-2">
          {(doc.status === "failed" || doc.status === "ready") && (
            <button
              type="button"
              onClick={onReprocess}
              className="text-[0.72rem] px-2.5 py-1 rounded-lg border border-foreground/10 text-foreground/60 hover:text-foreground/85"
            >
              Reprocess
            </button>
          )}
          {doc.hasOriginal && (
            <a
              href={`/api/documents/${doc.id}/original`}
              className="text-[0.72rem] px-2.5 py-1 rounded-lg border border-foreground/10 text-foreground/60 hover:text-foreground/85"
            >
              Download original
            </a>
          )}
        </div>
      </div>

      {isImage && (
        <div className="rounded-xl border border-foreground/[0.07] bg-foreground/[0.03] px-4 py-3 space-y-2">
          <p className="text-[0.65rem] uppercase tracking-[0.2em] text-foreground/30">Image scan</p>
          <div className="flex flex-wrap gap-1.5">
            {scanRows.map(row => (
              <span
                key={row.label}
                className={cn(
                  "text-[0.62rem] rounded-md border px-2 py-0.5",
                  row.tone === "ok" && "border-emerald-500/25 bg-emerald-500/10 text-emerald-200/80",
                  row.tone === "warn" && "border-amber-500/25 bg-amber-500/10 text-amber-200/80",
                  row.tone === "muted" && "border-foreground/10 bg-foreground/[0.04] text-foreground/45",
                )}
              >
                {row.label}
              </span>
            ))}
          </div>
          <p className="text-[0.68rem] text-foreground/40 leading-relaxed">
            {imageScan?.note
              ?? "OCR/vision text can be scanned. That is not the same as sanitizing the image."}
          </p>
        </div>
      )}

      {!isImage && (doc.redactionCount ?? 0) > 0 && (
        <div className="rounded-xl bg-amber-500/[0.07] border border-amber-500/20 px-4 py-3 space-y-2">
          <p className="text-sm font-medium text-amber-200/90 flex items-center gap-2">
            <Shield className="size-4 shrink-0" aria-hidden />
            {doc.redactionCount} detected {doc.redactionCount === 1 ? "item" : "items"} replaced
          </p>
          {doc.scrubEvents && doc.scrubEvents.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {doc.scrubEvents.map(ev => (
                <span
                  key={ev.category}
                  className="text-[0.62rem] rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-amber-200/70"
                >
                  {categoryLabel(ev.category)} ×{ev.count}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {isImage && doc.hasOriginal && (
        <div className="rounded-xl border border-foreground/[0.07] overflow-hidden bg-black/20">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/documents/${doc.id}/original`}
            alt={doc.name}
            className="max-h-72 w-full object-contain"
          />
        </div>
      )}

      {doc.extractMeta?.sheets && doc.extractMeta.sheets.length > 0 && (
        <div className="rounded-xl border border-foreground/[0.07] bg-foreground/[0.03] px-4 py-3 overflow-x-auto">
          <p className="text-[0.65rem] uppercase tracking-[0.2em] text-foreground/30 mb-2">Sheet preview</p>
          <table className="w-full text-[0.72rem] text-left">
            <thead>
              <tr className="text-foreground/40">
                <th className="py-1 pr-3 font-medium">Sheet</th>
                <th className="py-1 pr-3 font-medium">Rows</th>
                <th className="py-1 font-medium">Columns</th>
              </tr>
            </thead>
            <tbody>
              {doc.extractMeta.sheets.map(sheet => (
                <tr key={sheet.name} className="border-t border-foreground/[0.06] text-foreground/65">
                  <td className="py-1.5 pr-3 font-medium">{sheet.name}</td>
                  <td className="py-1.5 pr-3 tabular-nums">{sheet.rowCount}</td>
                  <td className="py-1.5 text-foreground/45 truncate max-w-[16rem]">
                    {sheet.headers.join(", ") || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {processed.trim() && (
        <details className="rounded-xl border border-foreground/[0.07] bg-foreground/[0.03] px-4 py-3 group">
          <summary className="cursor-pointer text-sm font-medium text-foreground/70 list-none flex items-center justify-between">
            <span>Processed content</span>
            <span className="text-[0.65rem] text-foreground/35 font-normal">
              {processed.length.toLocaleString()} chars
            </span>
          </summary>
          <div className="mt-3 space-y-2">
            <input
              type="search"
              value={contentQuery}
              onChange={e => {
                setContentQuery(e.target.value);
                setShowFullContent(false);
              }}
              placeholder="Search extracted content"
              className="w-full h-8 rounded-lg border border-foreground/10 bg-background px-2.5 text-[0.75rem] text-foreground"
            />
            <div className="max-h-64 overflow-y-auto rounded-lg border border-foreground/[0.06] px-3 py-2">
              <pre className="text-[0.75rem] text-foreground/55 leading-relaxed whitespace-pre-wrap font-mono">
                {preview || (contentQuery ? "No matching lines." : "No extracted text.")}
                {truncated && (
                  <span className="text-foreground/25">
                    {" "}… [{(filtered.length - CONTENT_PREVIEW).toLocaleString()} more chars]
                  </span>
                )}
              </pre>
            </div>
            {truncated && (
              <button
                type="button"
                onClick={() => setShowFullContent(true)}
                className="text-[0.72rem] text-indigo-300/80 hover:text-indigo-200"
              >
                View full extracted content
              </button>
            )}
          </div>
        </details>
      )}

      {chunkTotal > 0 && (
        <details className="rounded-xl border border-foreground/[0.07] bg-foreground/[0.03] px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium text-foreground/70 list-none">
            Technical details · {chunkTotal} indexed chunks
          </summary>
          <div className="mt-3 flex flex-col gap-1.5">
            {pageChunks.map((frag, i) => {
              const n = chunkPage * CHUNK_PAGE + i + 1;
              const open = openChunk === frag.id;
              return (
                <button
                  key={frag.id}
                  type="button"
                  onClick={() => setOpenChunk(open ? null : frag.id)}
                  className="text-left rounded-xl bg-foreground/[0.03] border border-foreground/[0.05] px-4 py-2.5"
                >
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="text-[0.6rem] font-mono text-foreground/25">#{n}</span>
                    {frag.provenance?.range && (
                      <span className="text-[0.6rem] font-mono text-emerald-300/60">{frag.provenance.range}</span>
                    )}
                    {frag.provenance?.sheet && !frag.provenance.range && (
                      <span className="text-[0.6rem] font-mono text-emerald-300/60">{frag.provenance.sheet}</span>
                    )}
                    {frag.provenance?.page != null && (
                      <span className="text-[0.6rem] font-mono text-sky-300/60">p.{frag.provenance.page}</span>
                    )}
                    <span className="text-[0.6rem] text-foreground/25">
                      {frag.content.length.toLocaleString()} chars
                    </span>
                  </div>
                  <p className={cn("text-[0.78rem] text-foreground/50 leading-relaxed", !open && "line-clamp-2")}>
                    {open ? frag.content : frag.content.slice(0, 160)}
                    {!open && frag.content.length > 160 && <span className="text-foreground/25">…</span>}
                  </p>
                </button>
              );
            })}
            {totalChunkPages > 1 && (
              <div className="flex items-center justify-between pt-1 text-[0.7rem] text-foreground/40">
                <button
                  type="button"
                  disabled={chunkPage === 0 || chunksLoading}
                  onClick={() => void loadChunkPage(chunkPage - 1)}
                  className="disabled:opacity-30"
                >
                  Previous
                </button>
                <span>
                  {chunksLoading ? "Loading…" : `${chunkPage + 1} / ${totalChunkPages}`}
                </span>
                <button
                  type="button"
                  disabled={chunkPage >= totalChunkPages - 1 || chunksLoading}
                  onClick={() => void loadChunkPage(chunkPage + 1)}
                  className="disabled:opacity-30"
                >
                  Next
                </button>
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  );
}

export function KnowledgeLibraryFilters({
  value,
  onChange,
  counts,
}: {
  value: KnowledgeLibraryFilter;
  onChange: (next: KnowledgeLibraryFilter) => void;
  counts: Record<KnowledgeLibraryFilter, number>;
}) {
  const options: { id: KnowledgeLibraryFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "documents", label: "Documents" },
    { id: "spreadsheets", label: "Spreadsheets" },
    { id: "images", label: "Images" },
  ];
  return (
    <div className="flex flex-wrap gap-1 p-0.5 bg-foreground/5 rounded-lg border border-foreground/10">
      {options.map(opt => (
        <button
          key={opt.id}
          type="button"
          onClick={() => onChange(opt.id)}
          className={cn(
            "flex-1 min-w-[4.5rem] text-[0.7rem] font-medium rounded-md py-1.5 transition-colors",
            value === opt.id
              ? "bg-indigo-500/25 text-indigo-200 ring-1 ring-indigo-400/30"
              : "text-foreground/50 hover:text-foreground/75",
          )}
        >
          {opt.label}
          {counts[opt.id] > 0 && (
            <span className="ml-1 text-foreground/35">{counts[opt.id]}</span>
          )}
        </button>
      ))}
    </div>
  );
}
