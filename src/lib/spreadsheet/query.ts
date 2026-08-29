import type { SpreadsheetQuery, SpreadsheetQueryResult, SpreadsheetTable } from "./types";

function columnIndex(table: SpreadsheetTable, column: string): number {
  const exact = table.headers.findIndex(h => h.toLowerCase() === column.toLowerCase());
  if (exact >= 0) return exact;
  const letter = column.trim().toUpperCase();
  if (/^[A-Z]{1,2}$/.test(letter)) {
    let n = 0;
    for (const ch of letter) n = n * 26 + (ch.charCodeAt(0) - 64);
    if (n >= 1 && n <= table.headers.length) return n - 1;
  }
  throw new Error(`Column "${column}" was not found on sheet ${table.name}`);
}

function toNumber(raw: string): number | null {
  const cleaned = raw.replace(/[$,%\s]/g, "");
  if (!cleaned || Number.isNaN(Number(cleaned))) return null;
  return Number(cleaned);
}

/**
 * Constrained analysis over an already-scrubbed workbook.
 * Does not send the grid to a model and never returns unsanitized source bytes.
 */
export function querySpreadsheet(
  tables: SpreadsheetTable[],
  query: SpreadsheetQuery,
): SpreadsheetQueryResult {
  const table =
    (query.sheet
      ? tables.find(t => t.name.toLowerCase() === query.sheet!.toLowerCase())
      : tables[0]) ?? null;
  if (!table) throw new Error(query.sheet ? `Sheet "${query.sheet}" was not found` : "Workbook has no sheets");

  const idx = columnIndex(table, query.column);
  let values = table.rows.map(r => r[idx] ?? "").filter(v => v !== "");
  if (query.equals != null && query.equals !== "") {
    const needle = query.equals.toLowerCase();
    values = table.rows
      .filter(r => r.some(c => c.toLowerCase() === needle))
      .map(r => r[idx] ?? "")
      .filter(v => v !== "");
  }

  const nums = values.map(toNumber).filter((n): n is number => n != null);

  switch (query.op) {
    case "count":
      return { sheet: table.name, column: query.column, op: query.op, value: values.length, n: values.length };
    case "distinct":
      return {
        sheet: table.name,
        column: query.column,
        op: query.op,
        value: [...new Set(values)].slice(0, 50),
        n: new Set(values).size,
      };
    case "sum":
      return { sheet: table.name, column: query.column, op: query.op, value: nums.reduce((a, b) => a + b, 0), n: nums.length };
    case "avg":
      return {
        sheet: table.name,
        column: query.column,
        op: query.op,
        value: nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0,
        n: nums.length,
      };
    case "min":
      return { sheet: table.name, column: query.column, op: query.op, value: nums.length ? Math.min(...nums) : 0, n: nums.length };
    case "max":
      return { sheet: table.name, column: query.column, op: query.op, value: nums.length ? Math.max(...nums) : 0, n: nums.length };
    default:
      throw new Error(`Unsupported spreadsheet operation`);
  }
}
