/**
 * Turn a reply into a file card when the model did not use the `file:` block.
 *
 * Models follow a format instruction with varying reliability. The app already knows the person asked
 * for a file (from their message), so it does not depend on the model: when the reply has the data in
 * an ordinary form (a CSV code block, a Markdown table, a Markdown document), this rewrites that part
 * of the reply into the same `file:<name>` block the file card renders. No model call, no cost, and
 * nothing leaves the browser.
 *
 * It only acts on a finished reply to a file request, never on a reply that already has a file block or
 * was cut off, and it leaves the reply unchanged when it cannot find data it is sure about.
 */

import { parseCsv } from "./csv";
import type { FileRequest } from "@/lib/turn-policy/file-request";

export type FallbackResult = {
  content: string;
  changed: boolean;
  /** What the file was made from, for tests and telemetry. */
  source?: "csv-block" | "table" | "text-block" | "document";
};

const SHEET_EXTS = new Set(["xlsx", "csv", "tsv"]);
const DOC_EXTS = new Set(["docx", "md"]);
const FILE_BLOCK = /^ {0,3}(`{3,}|~{3,})\s*file:/im;

type Fence = { start: number; end: number; marker: string; info: string; lang: string; body: string };

/** Fenced code blocks, in order. `end` is the line after the closing fence (or the last line if open). */
function findFences(lines: string[]): Fence[] {
  const out: Fence[] = [];
  let open: { start: number; marker: string; info: string } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(lines[i]);
    if (!m) continue;
    if (!open) {
      if (m[1][0] === "`" && m[2].includes("`")) continue;
      open = { start: i, marker: m[1], info: m[2].trim() };
    } else if (m[1][0] === open.marker[0] && m[1].length >= open.marker.length && m[2].trim() === "") {
      out.push({
        start: open.start,
        end: i + 1,
        marker: open.marker,
        info: open.info,
        lang: open.info.split(/\s+/)[0].toLowerCase(),
        body: lines.slice(open.start + 1, i).join("\n"),
      });
      open = null;
    }
  }
  return out;
}

function isOpenFence(lines: string[]): boolean {
  let open: string | null = null;
  for (const l of lines) {
    const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(l);
    if (!m) continue;
    if (!open) open = m[1];
    else if (m[1][0] === open[0] && m[1].length >= open.length && m[2].trim() === "") open = null;
  }
  return open !== null;
}

/** A consistent grid: at least two rows and two columns, most rows with the same number of cells. */
function looksTabular(rows: string[][]): boolean {
  if (rows.length < 2) return false;
  const widths = rows.map(r => r.length);
  const common = widths.sort((a, b) => a - b)[Math.floor(widths.length / 2)];
  if (common < 2) return false;
  const consistent = rows.filter(r => r.length === common).length;
  return consistent / rows.length >= 0.8;
}

const SHEET_LANGS = new Set(["csv", "tsv", "text", "txt", "plain", "plaintext", ""]);

function plainCsv(rows: string[][]): string {
  const q = (c: string) => (/[",\r\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c);
  return rows.map(r => r.map(q).join(",")).join("\n");
}

type MdTable = { start: number; end: number; rows: string[][] };

/** Markdown pipe tables outside fenced code. */
function findTables(lines: string[], fences: Fence[]): MdTable[] {
  const inFence = (i: number) => fences.some(f => i >= f.start && i < f.end);
  const out: MdTable[] = [];
  for (let i = 0; i < lines.length - 1; i++) {
    if (inFence(i) || !/\|/.test(lines[i]) || !/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(lines[i + 1])) continue;
    let j = i + 2;
    while (j < lines.length && /\|/.test(lines[j]) && lines[j].trim() !== "" && !inFence(j)) j++;
    const cells = (l: string) =>
      l.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, "|"));
    const rows = [cells(lines[i]), ...lines.slice(i + 2, j).map(cells)];
    if (looksTabular(rows)) out.push({ start: i, end: j, rows });
    i = j;
  }
  return out;
}

/** After the file, drop leftover "copy this into Notepad and save as .csv" paragraphs: the card replaces them. */
const MANUAL_SAVE = /\b(copy|paste|notepad|text editor|textedit|save (it |the file |this )?as|powershell|terminal)\b/i;

function dropManualSaveParagraphs(after: string): string {
  const paragraphs = after.split(/\n{2,}/);
  const kept = paragraphs.filter(p => !(p.trim() && p.length <= 700 && MANUAL_SAVE.test(p) && !/```/.test(p)));
  return kept.join("\n\n");
}

function fenceFor(content: string): string {
  const longest = Math.max(0, ...(content.match(/`{3,}/g) ?? []).map(s => s.length));
  return "`".repeat(Math.max(4, longest + 1));
}

function nameFor(ext: string, base: string): string {
  return `${base}.${ext}`;
}

export function applyFileFallback(content: string, request: FileRequest | null): FallbackResult {
  const unchanged: FallbackResult = { content, changed: false };
  if (!request || !content.trim()) return unchanged;
  if (FILE_BLOCK.test(content)) return unchanged;

  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  if (isOpenFence(lines)) return unchanged;
  const fences = findFences(lines);
  const ext = request.ext;

  const rewrite = (start: number, end: number, replacement: string[], source: FallbackResult["source"]): FallbackResult => {
    const before = lines.slice(0, start).join("\n");
    const after = dropManualSaveParagraphs(lines.slice(end).join("\n"));
    const pieces = [before.trimEnd(), replacement.join("\n"), after.trim()].filter(Boolean);
    return { content: pieces.join("\n\n"), changed: true, source };
  };

  // Spreadsheets: a CSV code block, else a Markdown table.
  if (!ext || SHEET_EXTS.has(ext)) {
    const want = ext ?? "csv";
    const delimiter = want === "tsv" ? "\t" : ",";
    for (const f of fences) {
      if (!SHEET_LANGS.has(f.lang)) continue;
      const rows = parseCsv(f.body, f.body.split("\n")[0]?.includes("\t") && !f.body.split("\n")[0].includes(",") ? "\t" : delimiter);
      if (!looksTabular(rows)) continue;
      return rewrite(f.start, f.end, [`${f.marker}file:${nameFor(want, "data")}`, f.body, f.marker], "csv-block");
    }
    const table = findTables(lines, fences)[0];
    if (table) {
      const body = plainCsv(table.rows);
      const fence = fenceFor(body);
      return rewrite(table.start, table.end, [`${fence}file:${nameFor(want, "table")}`, body, fence], "table");
    }
    if (ext) return unchanged;
  }

  // Documents: a Markdown code block, else the whole reply when it is clearly a structured document.
  if (!ext || DOC_EXTS.has(ext)) {
    const want = ext ?? "md";
    const md = fences.find(f => ["markdown", "md"].includes(f.lang) && /^#{1,6}\s/m.test(f.body));
    if (md) return rewrite(md.start, md.end, [`${md.marker}file:${nameFor(want, "document")}`, md.body, md.marker], "text-block");
    const headings = lines.filter(l => /^#{1,6}\s+\S/.test(l)).length;
    const listItems = lines.filter(l => /^\s*(?:[-*+]|\d+[.)])\s+\S/.test(l)).length;
    if (headings >= 1 && (headings >= 2 || listItems >= 3) && content.length >= 250) {
      const fence = fenceFor(content);
      return { content: [`${fence}file:${nameFor(want, "document")}`, content.trim(), fence].join("\n"), changed: true, source: "document" };
    }
    if (ext) return unchanged;
  }

  // Text, logs and data files: the code block in the matching language (or the only code block).
  const lang: Record<string, string[]> = {
    json: ["json", "jsonc"], yaml: ["yaml", "yml"], xml: ["xml"], sql: ["sql"], log: ["log", "text", "txt", "plain", "plaintext", ""],
    txt: ["text", "txt", "plain", "plaintext", ""], ini: ["ini"], toml: ["toml"],
  };
  const wanted = ext ? (lang[ext] ?? [ext]) : null;
  const candidates = wanted ? fences.filter(f => wanted.includes(f.lang)) : fences;
  const pick = candidates.length === 1 ? candidates[0] : wanted ? candidates.sort((a, b) => b.body.length - a.body.length)[0] : null;
  if (pick && pick.body.trim()) {
    const fileExt = ext ?? "txt";
    return rewrite(pick.start, pick.end, [`${pick.marker}file:${nameFor(fileExt, "output")}`, pick.body, pick.marker], "text-block");
  }
  return unchanged;
}
