import { describe, expect, it } from "vitest";
import { colLetter, extractCsvSpreadsheet, formatSheetRange } from "./parse";
import { querySpreadsheet } from "./query";

describe("spreadsheet locators", () => {
  it("converts 1-based columns to A1 letters", () => {
    expect(colLetter(1)).toBe("A");
    expect(colLetter(26)).toBe("Z");
    expect(colLetter(27)).toBe("AA");
  });

  it("formats a sheet range for citations", () => {
    expect(formatSheetRange("Sales", 12, 2, 28, 6)).toBe("Sales!B12:F28");
    expect(formatSheetRange("Q1 Revenue", 1, 1, 3, 2)).toBe("'Q1 Revenue'!A1:B3");
  });
});

describe("CSV extract", () => {
  it("builds header-aware chunks with row provenance", () => {
    const csv = Buffer.from("Region,Amount\nEast,10\nWest,25\nEast,5\n");
    const extracted = extractCsvSpreadsheet(csv, "sales.csv");
    expect(extracted.meta.kind).toBe("spreadsheet");
    expect(extracted.meta.sheets[0]?.headers).toEqual(["Region", "Amount"]);
    expect(extracted.chunks[0]?.provenance.range).toMatch(/sales!A2:B4/i);
    expect(extracted.chunks[0]?.content).toContain("Region=East");
    expect(extracted.chunks[0]?.content).toContain("Amount=25");
  });
});

describe("querySpreadsheet", () => {
  const tables = extractCsvSpreadsheet(
    Buffer.from("Region,Amount\nEast,10\nWest,25\nEast,5\n"),
    "sales.csv",
  ).tables;

  it("sums a numeric column", () => {
    const r = querySpreadsheet(tables, { column: "Amount", op: "sum" });
    expect(r.value).toBe(40);
    expect(r.n).toBe(3);
  });

  it("filters then counts", () => {
    const r = querySpreadsheet(tables, { column: "Region", op: "count", equals: "East" });
    expect(r.value).toBe(2);
  });
});
