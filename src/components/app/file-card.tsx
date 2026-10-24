"use client";

import { Download, FileCode, FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { buildFile, describeFile, saveBlob, sheetsOf, FileTooLargeError } from "@/lib/files/build";
import { csvFileText } from "@/lib/files/csv";
import { fileNameForCodeLanguage, specForName, type FileSpec } from "@/lib/files/file-spec";

/** ready: complete. preparing: the reply is still streaming. incomplete: the reply was cut off. */
export type FileCardState = "ready" | "preparing" | "incomplete";

const KIND_LABEL: Record<FileSpec["kind"], string> = {
  xlsx: "Excel workbook",
  csv: "CSV spreadsheet",
  tsv: "Tab-separated spreadsheet",
  docx: "Word document",
  md: "Markdown document",
  text: "Text file",
};

function KindIcon({ kind }: { kind: FileSpec["kind"] }) {
  const cls = "size-5";
  if (kind === "xlsx" || kind === "csv" || kind === "tsv") return <FileSpreadsheet className={cls} aria-hidden />;
  if (kind === "docx" || kind === "md") return <FileText className={cls} aria-hidden />;
  return <FileCode className={cls} aria-hidden />;
}

function errorText(err: unknown): string {
  if (err instanceof FileTooLargeError) return err.message;
  return "The file could not be built. Try asking for it again.";
}

/** A file the assistant wrote into its reply, built in the browser when Download is clicked. */
export function FileCard({
  spec,
  body,
  state,
}: {
  spec: FileSpec;
  body: string;
  state: FileCardState;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const summary = useMemo(() => (state === "preparing" ? null : describeFile(spec, body)), [spec, body, state]);
  const isSheet = spec.kind === "xlsx" || spec.kind === "csv" || spec.kind === "tsv";
  const previewRows = useMemo(
    () => (preview && isSheet ? (sheetsOf(body)[0]?.rows ?? []).slice(0, 12) : []),
    [preview, isSheet, body],
  );

  async function onDownload() {
    setBusy(true);
    setError(null);
    try {
      saveBlob(await buildFile(spec, body), spec.name);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="not-prose my-3 overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[var(--primary-soft)] text-[var(--primary-soft-foreground)]">
          <KindIcon kind={spec.kind} />
        </span>
        <div className="min-w-0 flex-1 basis-40">
          <p className="truncate text-sm font-medium text-foreground">{spec.name}</p>
          <p className="text-xs text-muted-foreground">
            {KIND_LABEL[spec.kind]}
            {state === "preparing" ? " · Preparing file…" : summary ? ` · ${summary}` : ""}
          </p>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {state !== "preparing" && (
            <button
              type="button"
              onClick={() => setPreview(v => !v)}
              aria-expanded={preview}
              className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground cursor-pointer"
            >
              {preview ? "Hide" : "Preview"}
            </button>
          )}
          <button
            type="button"
            onClick={() => void onDownload()}
            disabled={state === "preparing" || busy}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
              state === "preparing" || busy
                ? "bg-muted text-muted-foreground cursor-not-allowed"
                : "bg-primary text-primary-foreground hover:opacity-90 cursor-pointer",
            )}
          >
            {state === "preparing" || busy ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Download className="size-3.5" aria-hidden />
            )}
            {state === "incomplete" ? "Download partial" : "Download"}
          </button>
        </div>
      </div>

      {preview && (
        <div className="max-h-72 overflow-auto border-t border-border bg-[var(--code-bg)] px-4 py-3">
          {isSheet ? (
            <table className="text-xs">
              <tbody>
                {previewRows.map((row, ri) => (
                  <tr key={ri} className={ri === 0 ? "font-semibold" : undefined}>
                    {row.map((cell, ci) => (
                      <td key={ci} className="border border-border px-2 py-1 align-top whitespace-pre-wrap">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <pre className="m-0 whitespace-pre-wrap break-words bg-transparent p-0 text-xs text-foreground">{body}</pre>
          )}
        </div>
      )}

      <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
        {state === "incomplete"
          ? "This reply was cut off, so the file is not complete. Choose Continue below the reply to get the rest."
          : "Built in your browser from this reply. Redacted values stay redacted."}
        {spec.renamed && " Saved as .txt because that file type can run when it is opened."}
        {error && <span className="mt-1 block text-destructive" role="alert">{error}</span>}
      </div>
    </div>
  );
}

/** CSV and Excel buttons above a table in any reply. */
export function TableDownloads({ rows }: { rows: string[][] }) {
  const [busy, setBusy] = useState(false);
  if (rows.length === 0) return null;

  async function asExcel() {
    setBusy(true);
    try {
      const spec = specForName("table.xlsx");
      const { buildXlsx } = await import("@/lib/files/build-xlsx");
      saveBlob(new Blob([await buildXlsx([{ name: "Table", rows }])], { type: spec.mime }), spec.name);
    } finally {
      setBusy(false);
    }
  }

  function asCsv() {
    const spec = specForName("table.csv");
    saveBlob(new Blob([csvFileText(rows)], { type: spec.mime }), spec.name);
  }

  return (
    <div className="not-prose -mb-2 mt-2 flex justify-end gap-1" aria-label="Download this table">
      <button type="button" onClick={asCsv} className="code-block-copy">
        <Download className="size-3.5" aria-hidden />
        CSV
      </button>
      <button type="button" onClick={() => void asExcel()} disabled={busy} className="code-block-copy">
        {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Download className="size-3.5" aria-hidden />}
        Excel
      </button>
    </div>
  );
}

/** Download button for an ordinary code block, next to Copy. */
export function CodeDownloadButton({ language, code }: { language: string; code: string }) {
  function onClick() {
    const spec = specForName(fileNameForCodeLanguage(language));
    saveBlob(new Blob([code.endsWith("\n") ? code : `${code}\n`], { type: spec.mime }), spec.name);
  }
  return (
    <button type="button" onClick={onClick} aria-label="Download code as a file" className="code-block-copy">
      <Download className="size-3.5" aria-hidden />
      <span>Download</span>
    </button>
  );
}
