/**
 * POST /api/documents/[id]/analyze
 * Constrained spreadsheet totals/filters over already-scrubbed tables.
 */

export const runtime = "nodejs";

import { getPersistedDocument } from "@/lib/documents/persist";
import { originalExists, readSpreadsheetTables } from "@/lib/document-storage";
import { getIdentity } from "@/lib/identity";
import { querySpreadsheet } from "@/lib/spreadsheet/query";
import type { SpreadsheetQuery } from "@/lib/spreadsheet/types";
import { NextRequest, NextResponse } from "next/server";

type Params = { params: Promise<{ id: string }> };

const OPS = new Set(["sum", "count", "min", "max", "distinct", "avg"]);

export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { userId } = await getIdentity(req);

  const doc = await getPersistedDocument(userId, id);
  if (!doc) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }
  if (!originalExists(doc.storageKey)) {
    return NextResponse.json({ error: "No structured workbook is stored for this file" }, { status: 404 });
  }

  const tables = await readSpreadsheetTables(doc.storageKey!);
  if (!tables?.length) {
    return NextResponse.json({ error: "No sheet tables available. Reprocess the workbook." }, { status: 422 });
  }

  let body: Partial<SpreadsheetQuery>;
  try {
    body = await req.json() as Partial<SpreadsheetQuery>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.column || typeof body.column !== "string" || !body.op || !OPS.has(body.op)) {
    return NextResponse.json(
      { error: "Provide column and op (sum | count | min | max | avg | distinct)." },
      { status: 400 },
    );
  }

  try {
    const result = querySpreadsheet(tables, {
      sheet: typeof body.sheet === "string" ? body.sheet : undefined,
      column: body.column,
      op: body.op,
      equals: typeof body.equals === "string" ? body.equals : undefined,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Query failed" },
      { status: 422 },
    );
  }
}
