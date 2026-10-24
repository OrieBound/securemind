/**
 * Turn the body of a `file:` block into the bytes of a real file. Everything runs in the browser
 * when the person clicks Download; the heavy libraries load only then.
 */

import { columnCount, csvFileText, parseCsv, splitSheets, type Sheet } from "./csv";
import { MAX_FILE_BYTES, type FileSpec, utf8Length } from "./file-spec";

export class FileTooLargeError extends Error {
  constructor() {
    super(`This file is larger than ${Math.round(MAX_FILE_BYTES / (1024 * 1024))} MB, so it was not built.`);
    this.name = "FileTooLargeError";
  }
}

/** Tabs and no commas in the first line means tab-separated. */
function delimiterOf(body: string): string {
  const first = body.split(/\r?\n/).find(l => l.trim() !== "") ?? "";
  return first.includes("\t") && !first.includes(",") ? "\t" : ",";
}

export function sheetsOf(body: string): Sheet[] {
  return splitSheets(body, delimiterOf(body));
}

/** A one-line description for the file card, such as "24 rows · 5 columns · 2 sheets". */
export function describeFile(spec: FileSpec, body: string): string {
  if (spec.kind === "xlsx" || spec.kind === "csv" || spec.kind === "tsv") {
    const sheets = spec.kind === "xlsx" ? sheetsOf(body) : [{ name: "", rows: parseCsv(body, spec.kind === "tsv" ? "\t" : delimiterOf(body)) }];
    const rows = sheets.reduce((n, s) => n + s.rows.length, 0);
    const cols = Math.max(0, ...sheets.map(s => columnCount(s.rows)));
    const parts = [`${rows} row${rows === 1 ? "" : "s"}`, `${cols} column${cols === 1 ? "" : "s"}`];
    if (sheets.length > 1) parts.push(`${sheets.length} sheets`);
    return parts.join(" · ");
  }
  if (spec.kind === "docx" || spec.kind === "md") {
    // Count words, not Markdown symbols such as "#" or "-".
    const words = body.split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w)).length;
    const sections = (body.match(/^#{1,6}\s/gm) ?? []).length;
    return [sections ? `${sections} section${sections === 1 ? "" : "s"}` : null, `${words} words`]
      .filter(Boolean)
      .join(" · ");
  }
  const lines = body.split(/\r?\n/).length;
  return `${lines} line${lines === 1 ? "" : "s"}`;
}

export async function buildFile(spec: FileSpec, body: string): Promise<Blob> {
  if (utf8Length(body) > MAX_FILE_BYTES) throw new FileTooLargeError();

  let part: BlobPart;
  switch (spec.kind) {
    case "xlsx": {
      const { buildXlsx } = await import("./build-xlsx");
      part = await buildXlsx(sheetsOf(body));
      break;
    }
    case "csv":
    case "tsv": {
      const delimiter = spec.kind === "tsv" ? "\t" : ",";
      // A spreadsheet body may arrive with sheet markers; a CSV holds one table, so use the first sheet.
      const rows = splitSheets(body, spec.kind === "tsv" ? "\t" : delimiterOf(body))[0]?.rows ?? [];
      part = csvFileText(rows, delimiter);
      break;
    }
    case "docx": {
      const { buildDocx } = await import("./build-docx");
      part = await buildDocx(body, spec.name.replace(/\.[^.]+$/, ""));
      break;
    }
    default:
      part = body.endsWith("\n") ? body : `${body}\n`;
  }

  const blob = new Blob([part], { type: spec.mime });
  if (blob.size > MAX_FILE_BYTES) throw new FileTooLargeError();
  return blob;
}

/** Offer a blob as a download with the given (already clean) file name. */
export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
