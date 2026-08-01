"use client";

import { useRef, useState, type ReactNode } from "react";
import { Download, FileSpreadsheet, FileText, ImageIcon } from "lucide-react";
import {
  copyText,
  downloadPngFromSvg,
  downloadSvgElement,
  downloadText,
  markdownSummary,
  rowsToCsv,
  type ExportMeta,
} from "@/lib/analytics/export";

type Props = {
  title: string;
  interpretation: string;
  rangeLabel: string;
  workspaceLabel: string;
  disclaimer?: string;
  loading?: boolean;
  error?: string | null;
  empty?: boolean;
  emptyMessage?: string;
  children: ReactNode;
  /** Accessible data table alternative */
  tableHeaders?: string[];
  tableRows?: (string | number | null | undefined)[][];
  summaryLines?: string[];
};

export function ChartFrame({
  title,
  interpretation,
  rangeLabel,
  workspaceLabel,
  disclaimer,
  loading,
  error,
  empty,
  emptyMessage = "Not enough data for this chart yet.",
  children,
  tableHeaders,
  tableRows,
  summaryLines,
}: Props) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [exportNote, setExportNote] = useState<string | null>(null);

  const meta: ExportMeta = {
    title,
    rangeLabel,
    workspaceLabel,
    disclaimer,
  };

  async function withNote(label: string, fn: () => Promise<void> | void) {
    try {
      await fn();
      setExportNote(label);
      setTimeout(() => setExportNote(null), 2000);
    } catch {
      setExportNote("Export failed — try Download CSV instead");
      setTimeout(() => setExportNote(null), 3000);
    }
  }

  function findSvg(): SVGElement | null {
    return frameRef.current?.querySelector("svg") ?? null;
  }

  return (
    <section
      className="rounded-xl border border-white/10 bg-white/[0.03] p-4 sm:p-5"
      aria-labelledby={`chart-${title.replace(/\s+/g, "-").toLowerCase()}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h3
            id={`chart-${title.replace(/\s+/g, "-").toLowerCase()}`}
            className="text-sm font-semibold text-white/90"
          >
            {title}
          </h3>
          <p className="text-xs text-white/45 mt-1 max-w-prose">{interpretation}</p>
          <p className="text-[0.65rem] text-white/30 mt-1">
            {rangeLabel} · {workspaceLabel}
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          <ExportBtn
            label="PNG"
            icon={<ImageIcon className="size-3.5" />}
            onClick={() =>
              withNote("PNG downloaded", async () => {
                const svg = findSvg();
                if (!svg) throw new Error("No chart SVG");
                await downloadPngFromSvg(svg, meta, `${slug(title)}.png`);
              })
            }
          />
          <ExportBtn
            label="SVG"
            icon={<Download className="size-3.5" />}
            onClick={() =>
              withNote("SVG downloaded", async () => {
                const svg = findSvg();
                if (!svg) throw new Error("No chart SVG");
                await downloadSvgElement(svg, meta, `${slug(title)}.svg`);
              })
            }
          />
          <ExportBtn
            label="CSV"
            icon={<FileSpreadsheet className="size-3.5" />}
            onClick={() =>
              withNote("CSV downloaded", () => {
                if (!tableHeaders || !tableRows) throw new Error("No table");
                downloadText(
                  `${slug(title)}.csv`,
                  rowsToCsv(tableHeaders, tableRows),
                  "text/csv;charset=utf-8",
                );
              })
            }
          />
          <ExportBtn
            label="Copy"
            icon={<FileText className="size-3.5" />}
            onClick={() =>
              withNote("Summary copied", async () => {
                const md = markdownSummary(meta, summaryLines ?? [interpretation]);
                const ok = await copyText(md);
                if (!ok) throw new Error("Clipboard blocked");
              })
            }
          />
        </div>
      </div>

      {exportNote && (
        <p className="text-[0.65rem] text-emerald-400/80 mb-2" role="status">
          {exportNote}
        </p>
      )}

      <div ref={frameRef} className="min-h-[220px]">
        {loading && (
          <div className="flex h-[220px] items-center justify-center text-sm text-white/40">
            Loading…
          </div>
        )}
        {!loading && error && (
          <div className="flex h-[220px] items-center justify-center text-sm text-rose-300/80 px-4 text-center">
            {error}
          </div>
        )}
        {!loading && !error && empty && (
          <div className="flex h-[220px] items-center justify-center text-sm text-white/35 px-4 text-center">
            {emptyMessage}
          </div>
        )}
        {!loading && !error && !empty && children}
      </div>

      {tableHeaders && tableRows && tableRows.length > 0 && !loading && !error && !empty && (
        <details className="mt-3">
          <summary className="text-xs text-white/40 cursor-pointer hover:text-white/60">
            Data table
          </summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-xs text-left text-white/70">
              <caption className="sr-only">{title} data</caption>
              <thead>
                <tr className="border-b border-white/10 text-white/40">
                  {tableHeaders.map(h => (
                    <th key={h} className="py-1.5 pr-3 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tableRows.map((row, i) => (
                  <tr key={i} className="border-b border-white/5">
                    {row.map((cell, j) => (
                      <td key={j} className="py-1.5 pr-3">
                        {cell ?? "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  );
}

function ExportBtn({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[0.65rem] text-white/55 hover:text-white/85 hover:bg-white/[0.07]"
    >
      {icon}
      {label}
    </button>
  );
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
