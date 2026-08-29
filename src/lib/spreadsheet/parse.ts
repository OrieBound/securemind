import type {
  ChunkProvenance,
  ExtractedSpreadsheet,
  SpreadsheetChunk,
  SpreadsheetTable,
} from "./types";

const ROWS_PER_CHUNK = 25;
const MAX_SHEETS = 40;
const MAX_COLS = 40;
const MAX_ROWS = 2_000;

export function colLetter(index1: number): string {
  let n = index1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out || "A";
}

export function formatSheetRange(
  sheet: string,
  startRow: number,
  startCol: number,
  endRow: number,
  endCol: number,
): string {
  const safe = sheet.replace(/'/g, "''");
  const quoted = /[^A-Za-z0-9_]/.test(sheet) ? `'${safe}'` : safe;
  return `${quoted}!${colLetter(startCol)}${startRow}:${colLetter(endCol)}${endRow}`;
}

function cellText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.replace(/\x00/g, "").trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object" && "text" in value && typeof (value as { text: unknown }).text === "string") {
    return (value as { text: string }).text.trim();
  }
  if (typeof value === "object" && "result" in value) {
    return cellText((value as { result: unknown }).result);
  }
  return String(value).trim();
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQuotes = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ",") {
      row.push(cur.trim());
      cur = "";
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cur.trim());
      cur = "";
      if (row.some(c => c)) rows.push(row);
      row = [];
      continue;
    }
    cur += ch;
  }
  row.push(cur.trim());
  if (row.some(c => c)) rows.push(row);
  return rows;
}

function tableFromGrid(name: string, grid: string[][]): SpreadsheetTable {
  const limited = grid.slice(0, MAX_ROWS).map(r => r.slice(0, MAX_COLS));
  const headers = (limited[0] ?? []).map((h, i) => h || `Column ${colLetter(i + 1)}`);
  const rows = limited.slice(1).map(r => {
    const next = r.slice(0, headers.length);
    while (next.length < headers.length) next.push("");
    return next;
  });
  return { name, headers, rows };
}

function chunksFromTable(table: SpreadsheetTable): SpreadsheetChunk[] {
  const chunks: SpreadsheetChunk[] = [];
  if (table.rows.length === 0) {
    const provenance: ChunkProvenance = {
      kind: "sheet",
      sheet: table.name,
      range: formatSheetRange(table.name, 1, 1, 1, Math.max(1, table.headers.length)),
      headers: table.headers,
    };
    chunks.push({
      content: `Sheet ${table.name}\nHeaders: ${table.headers.join(" | ")}\n(no data rows)`,
      provenance,
    });
    return chunks;
  }

  for (let start = 0; start < table.rows.length; start += ROWS_PER_CHUNK) {
    const slice = table.rows.slice(start, start + ROWS_PER_CHUNK);
    const excelStart = start + 2; // header is row 1
    const excelEnd = start + slice.length + 1;
    const endCol = Math.max(1, table.headers.length);
    const range = formatSheetRange(table.name, excelStart, 1, excelEnd, endCol);
    const lines = [
      `Sheet ${table.name} (${range})`,
      `Headers: ${table.headers.join(" | ")}`,
      ...slice.map((row, i) => {
        const rowNum = excelStart + i;
        const pairs = table.headers
          .map((h, c) => `${h}=${row[c] ?? ""}`)
          .filter(p => !p.endsWith("="));
        return `Row ${rowNum}: ${pairs.join("; ")}`;
      }),
    ];
    chunks.push({
      content: lines.join("\n"),
      provenance: {
        kind: "sheet",
        sheet: table.name,
        range,
        headers: table.headers,
      },
    });
  }
  return chunks;
}

function buildExtracted(tables: SpreadsheetTable[]): ExtractedSpreadsheet {
  const chunks = tables.flatMap(chunksFromTable);
  const text = tables
    .map(t => {
      const preview = t.rows
        .slice(0, 8)
        .map((r, i) => `  ${i + 2}: ${r.join(" | ")}`)
        .join("\n");
      return `# ${t.name}\n${t.headers.join(" | ")}\n${preview}`;
    })
    .join("\n\n");
  return {
    text,
    chunks,
    meta: {
      kind: "spreadsheet",
      sheets: tables.map(t => ({
        name: t.name,
        headers: t.headers,
        rowCount: t.rows.length,
        colCount: t.headers.length,
      })),
    },
    tables,
  };
}

export function extractCsvSpreadsheet(buffer: Buffer, filename = "sheet.csv"): ExtractedSpreadsheet {
  const name = filename.replace(/\.[^.]+$/, "") || "Sheet1";
  const table = tableFromGrid(name, parseCsv(buffer.toString("utf-8")));
  return buildExtracted([table]);
}

export async function extractXlsxSpreadsheet(buffer: Buffer): Promise<ExtractedSpreadsheet> {
  // exceljs is a zip/XML parser — keep it external to the bundler.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ExcelJS = require("exceljs") as typeof import("exceljs");
  const wb = new ExcelJS.Workbook();
  // ExcelJS typings accept Buffer; runtime accepts Node Buffer.
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);

  const tables: SpreadsheetTable[] = [];
  let seen = 0;
  wb.eachSheet(sheet => {
    if (seen >= MAX_SHEETS) return;
    seen++;
    const grid: string[][] = [];
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber > MAX_ROWS) return;
      const cells: string[] = [];
      const count = Math.min(row.cellCount, MAX_COLS);
      for (let c = 1; c <= count; c++) {
        const cell = row.getCell(c);
        const formula = typeof cell.formula === "string" ? cell.formula : "";
        const value = cellText(cell.value);
        cells.push(formula ? `${value} [=${formula}]` : value);
      }
      if (cells.some(v => v)) grid.push(cells);
    });
    if (grid.length === 0) {
      tables.push({ name: sheet.name, headers: ["(empty)"], rows: [] });
      return;
    }
    tables.push(tableFromGrid(sheet.name, grid));
  });

  if (tables.length === 0) {
    throw new Error("No readable sheets found in this workbook");
  }
  return buildExtracted(tables);
}
