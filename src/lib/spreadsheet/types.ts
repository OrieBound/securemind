/** Structure-aware spreadsheet types. Cell values are expected to be scrubbed. */

export type ChunkProvenance = {
  kind: "sheet" | "page" | "text";
  sheet?: string;
  /** A1-style locator, e.g. Sales!B12:F28 */
  range?: string;
  page?: number;
  headers?: string[];
};

export type SpreadsheetSheetMeta = {
  name: string;
  headers: string[];
  rowCount: number;
  colCount: number;
};

export type SpreadsheetChunk = {
  content: string;
  provenance: ChunkProvenance;
};

export type ExtractedSpreadsheet = {
  text: string;
  chunks: SpreadsheetChunk[];
  meta: {
    kind: "spreadsheet";
    sheets: SpreadsheetSheetMeta[];
  };
  /** Scrubbed grid used by the constrained analysis tool. */
  tables: SpreadsheetTable[];
};

export type SpreadsheetTable = {
  name: string;
  headers: string[];
  /** Row-major scrubbed string cells (header row excluded). */
  rows: string[][];
};

export type SpreadsheetQuery = {
  sheet?: string;
  column: string;
  op: "sum" | "count" | "min" | "max" | "distinct" | "avg";
  equals?: string;
};

export type SpreadsheetQueryResult = {
  sheet: string;
  column: string;
  op: SpreadsheetQuery["op"];
  value: number | string[];
  n: number;
};
