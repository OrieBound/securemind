import type { Sheet } from "./csv";

/** Whole and decimal numbers without a leading zero (so ZIP codes and IDs like 00123 stay text). */
const NUMERIC = /^-?(?:0|[1-9]\d{0,14})(?:\.\d+)?$/;

function cellValue(raw: string): string | number {
  const value = raw.trim();
  if (NUMERIC.test(value)) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  // Written as a string. exceljs only writes a formula when given { formula }, so text such as
  // "=1+1" opens as literal text, never as a formula.
  return raw;
}

/** Build an .xlsx workbook: one worksheet per sheet, bold frozen header row, sensible column widths. */
export async function buildXlsx(sheets: Sheet[]): Promise<Uint8Array<ArrayBuffer>> {
  const mod = await import("exceljs");
  const ExcelJS = ((mod as unknown as { default?: typeof mod }).default ?? mod) as typeof mod;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "SecureMind";
  workbook.created = new Date();

  for (const sheet of sheets) {
    const ws = workbook.addWorksheet(sheet.name);
    for (const row of sheet.rows) ws.addRow(row.map(cellValue));

    if (sheet.rows.length > 1) {
      ws.getRow(1).font = { bold: true };
      ws.views = [{ state: "frozen", ySplit: 1 }];
    }
    const widths: number[] = [];
    for (const row of sheet.rows) {
      row.forEach((cell, i) => {
        const longest = Math.max(...cell.split(/\r?\n/).map(l => l.length));
        widths[i] = Math.max(widths[i] ?? 0, longest);
      });
    }
    widths.forEach((w, i) => {
      ws.getColumn(i + 1).width = Math.min(Math.max(w + 2, 8), 60);
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}
