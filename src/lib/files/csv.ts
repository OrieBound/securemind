/**
 * CSV for generated spreadsheets: read what the model wrote, split it into sheets, and write it
 * back out safely.
 *
 * Spreadsheet formula injection: a cell such as `=HYPERLINK(...)` or `@SUM(...)` runs as a formula
 * when a CSV is opened in Excel. Model output can be steered by a poisoned document, so every such
 * cell is written as text by prefixing `'`. Plain numbers like `-12.5` are left alone.
 */

export type Sheet = { name: string; rows: string[][] };

const BOM = "﻿";

/**
 * Parse RFC 4180 style CSV: quoted fields, doubled quotes, delimiters and newlines inside quotes.
 * Models often write "a, b", so unquoted fields are trimmed; quoted fields are kept exactly.
 */
export function parseCsv(text: string, delimiter = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let inQuotes = false;
  const src = text.startsWith(BOM) ? text.slice(1) : text;

  const endField = () => {
    row.push(quoted ? field : field.trim());
    field = "";
    quoted = false;
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && !quoted && field.trim() === "") {
      inQuotes = true;
      quoted = true;
      field = "";
    } else if (ch === delimiter) {
      endField();
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      endField();
      rows.push(row);
      row = [];
    } else if (quoted && (ch === " " || ch === "\t")) {
      // Space between a closing quote and the delimiter: ignore it.
    } else {
      field += ch;
    }
  }
  if (field !== "" || quoted || row.length > 0) {
    endField();
    rows.push(row);
  }
  // Drop fully empty trailing lines.
  while (rows.length && rows[rows.length - 1].every(c => c.trim() === "")) rows.pop();
  return rows;
}

const SHEET_LINE = /^\s*-{3,}\s*sheet\s*:\s*(.+?)\s*-{3,}\s*$/i;
const INVALID_SHEET_CHARS = /[[\]:*?/\\]/g;

/** Excel sheet names: at most 31 characters, none of `[ ] : * ? / \`, unique within the workbook. */
function cleanSheetName(raw: string, taken: Set<string>): string {
  const name = raw.replace(INVALID_SHEET_CHARS, " ").replace(/\s+/g, " ").trim().slice(0, 31) || "Sheet";
  let candidate = name;
  let n = 2;
  while (taken.has(candidate.toLowerCase())) {
    const suffix = ` (${n++})`;
    candidate = name.slice(0, 31 - suffix.length) + suffix;
  }
  taken.add(candidate.toLowerCase());
  return candidate;
}

/**
 * Split a spreadsheet body into sheets. A line `--- sheet: Name ---` starts a new sheet; text before
 * the first such line (or a body without any) becomes "Sheet1".
 */
export function splitSheets(body: string, delimiter = ","): Sheet[] {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const chunks: Array<{ name: string; lines: string[] }> = [];
  let current: { name: string; lines: string[] } = { name: "Sheet1", lines: [] };
  for (const line of lines) {
    const m = SHEET_LINE.exec(line);
    if (m) {
      if (current.lines.some(l => l.trim() !== "")) chunks.push(current);
      current = { name: m[1], lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  if (current.lines.some(l => l.trim() !== "") || chunks.length === 0) chunks.push(current);

  const taken = new Set<string>();
  return chunks.map(c => ({
    name: cleanSheetName(c.name, taken),
    rows: parseCsv(c.lines.join("\n"), delimiter),
  }));
}

const PLAIN_NUMBER = /^[+-]?(\d+([.,]\d+)*|\d*\.\d+)(e[+-]?\d+)?%?$/i;

/** True when a cell would be read as a formula or a command by a spreadsheet. */
export function isRiskyCell(value: string): boolean {
  if (!/^[=+\-@\t\r]/.test(value)) return false;
  return !PLAIN_NUMBER.test(value.trim());
}

/** Make a cell safe to open in a spreadsheet: formulas and commands become literal text. */
export function neutralizeCell(value: string): string {
  return isRiskyCell(value) ? `'${value}` : value;
}

function quoteField(value: string, delimiter: string): string {
  return /["\r\n]/.test(value) || value.includes(delimiter) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Write rows as CSV (or TSV) with CRLF line ends, the format Excel expects. */
export function toCsv(rows: string[][], delimiter = ","): string {
  return rows.map(r => r.map(c => quoteField(neutralizeCell(c ?? ""), delimiter)).join(delimiter)).join("\r\n");
}

/** A CSV file Excel opens with the right characters: UTF-8 with a byte-order mark. */
export function csvFileText(rows: string[][], delimiter = ","): string {
  return BOM + toCsv(rows, delimiter) + "\r\n";
}

/** Columns in the widest row, for the file card summary. */
export function columnCount(rows: string[][]): number {
  return rows.reduce((max, r) => Math.max(max, r.length), 0);
}
