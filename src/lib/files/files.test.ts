import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import ExcelJS from "exceljs";
import { csvFileText, isRiskyCell, neutralizeCell, parseCsv, splitSheets, toCsv } from "./csv";
import { fileNameForCodeLanguage, parseFileInfo, sanitizeFileName, specForName } from "./file-spec";
import { buildFile, describeFile, FileTooLargeError } from "./build";
import { buildXlsx } from "./build-xlsx";
import { buildDocx } from "./build-docx";

describe("file names", () => {
  it("keeps a normal name and type", () => {
    expect(specForName("Q3 inventory.xlsx")).toMatchObject({ name: "Q3-inventory.xlsx", kind: "xlsx", renamed: false });
    expect(specForName("steps.docx").kind).toBe("docx");
    expect(specForName("app.log")).toMatchObject({ kind: "text", mime: "text/plain" });
    expect(specForName("data.json").mime).toBe("application/json");
  });

  it("drops folders and characters Windows or browsers reject", () => {
    expect(sanitizeFileName("../../etc/passwd.txt").name).toBe("passwd.txt");
    expect(sanitizeFileName("C:\\Users\\me\\report.csv").name).toBe("report.csv");
    expect(sanitizeFileName('bad<>:"|?*name.md').name).toBe("badname.md");
    expect(sanitizeFileName("   ").name).toBe("file.txt");
    expect(sanitizeFileName("...hidden.txt").name).toBe("hidden.txt");
  });

  it("saves anything that would run on open as plain text", () => {
    for (const raw of ["setup.bat", "page.html", "image.svg", "run.exe", "script.js", "macro.xlsm"]) {
      const spec = specForName(raw);
      expect(spec.ext, raw).toBe("txt");
      expect(spec.name, raw).toBe(`${raw}.txt`);
      expect(spec.renamed, raw).toBe(true);
    }
  });

  it("caps long names at 80 characters", () => {
    const name = sanitizeFileName(`${"a".repeat(200)}.csv`).name;
    expect(name.length).toBeLessThanOrEqual(80);
    expect(name.endsWith(".csv")).toBe(true);
  });

  it("reads the file: info string of a fenced block", () => {
    expect(parseFileInfo("file:report.xlsx")?.name).toBe("report.xlsx");
    expect(parseFileInfo('file:"Q3 report.xlsx"')?.name).toBe("Q3-report.xlsx");
    expect(parseFileInfo("python")).toBeNull();
    expect(parseFileInfo("file:")).toBeNull();
  });

  it("names code-block downloads from the language and never as runnable web types", () => {
    expect(fileNameForCodeLanguage("python")).toBe("snippet.py");
    expect(fileNameForCodeLanguage("bash")).toBe("snippet.sh");
    expect(fileNameForCodeLanguage("html")).toBe("snippet.html.txt");
    expect(fileNameForCodeLanguage("javascript")).toBe("snippet.js.txt");
    expect(fileNameForCodeLanguage("whatever")).toBe("snippet.txt");
  });
});

describe("CSV", () => {
  it("parses quotes, doubled quotes, embedded commas and newlines", () => {
    expect(parseCsv('name,note\n"Smith, J","said ""hi""\nthen left"\n')).toEqual([
      ["name", "note"],
      ["Smith, J", 'said "hi"\nthen left'],
    ]);
  });

  it("trims model-style spacing outside quotes and keeps it inside", () => {
    expect(parseCsv('a, b ,  "  c  " \n')).toEqual([["a", "b", "  c  "]]);
  });

  it("neutralises formulas and commands but leaves plain numbers", () => {
    expect(isRiskyCell("=1+1")).toBe(true);
    expect(isRiskyCell("@SUM(A1:A2)")).toBe(true);
    expect(isRiskyCell("+cmd|' /C calc'!A0")).toBe(true);
    expect(isRiskyCell("-12.5")).toBe(false);
    expect(isRiskyCell("+44")).toBe(false);
    expect(neutralizeCell("=HYPERLINK(\"http://x\")")).toBe("'=HYPERLINK(\"http://x\")");
    expect(toCsv([["=1+1", "-3", "ok"]])).toBe("'=1+1,-3,ok");
  });

  it("writes a byte-order mark and CRLF so Excel opens accents correctly", () => {
    const text = csvFileText([["café", "naïve"]]);
    expect(text.startsWith("\uFEFF")).toBe(true);
    expect(text.endsWith("\r\n")).toBe(true);
  });

  it("splits sheets and cleans their names", () => {
    const sheets = splitSheets("--- sheet: Q1/2026 ---\na,b\n1,2\n--- sheet: Q1/2026 ---\nc\n3\n");
    expect(sheets.map(s => s.name)).toEqual(["Q1 2026", "Q1 2026 (2)"]);
    expect(sheets[0].rows).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("treats a body without markers as one sheet", () => {
    expect(splitSheets("x,y\n1,2").map(s => s.name)).toEqual(["Sheet1"]);
  });
});

describe("Excel", () => {
  it("round-trips sheets, stores numbers as numbers and formula-like text as text", async () => {
    const bytes = await buildXlsx([
      { name: "Stock", rows: [["Item", "Qty", "Code", "Note"], ["Bolts", "120", "00123", "=1+1"]] },
      { name: "Second", rows: [["only"]] },
    ]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes.buffer as ArrayBuffer);
    expect(wb.worksheets.map(w => w.name)).toEqual(["Stock", "Second"]);
    const ws = wb.getWorksheet("Stock")!;
    expect(ws.getCell("A1").value).toBe("Item");
    expect(ws.getCell("A1").font?.bold).toBe(true);
    expect(ws.getCell("B2").value).toBe(120);
    expect(ws.getCell("C2").value).toBe("00123");
    expect(ws.getCell("D2").value).toBe("=1+1");
    expect(ws.getCell("D2").formula).toBeUndefined();
  });
});

describe("Word", () => {
  it("contains headings, list items, table cells and code from the Markdown", async () => {
    const md = [
      "# Reset a password",
      "Follow **these** steps.",
      "1. Open *Settings*",
      "2. Choose `Profile`",
      "   - nested note",
      "",
      "| Step | Owner |",
      "| --- | --- |",
      "| Approve | Admin |",
      "",
      "```bash",
      "npm run dev",
      "```",
      "See [the docs](https://example.com/docs) and [a script](javascript:alert(1)).",
    ].join("\n");
    const bytes = await buildDocx(md, "steps");
    const zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file("word/document.xml")!.async("string");
    for (const text of ["Reset a password", "these", "Open ", "Settings", "Profile", "nested note", "Approve", "Admin", "npm run dev"]) {
      expect(xml, text).toContain(text);
    }
    expect(xml).toContain("Heading1");
    expect(xml).toContain("w:numPr");
    expect(xml).toContain("w:tbl");
    const rels = await zip.file("word/_rels/document.xml.rels")!.async("string");
    expect(rels).toContain("https://example.com/docs");
    expect(rels).not.toContain("javascript:");
  });
});

describe("building and describing files", () => {
  it("describes spreadsheets, documents and text", () => {
    expect(describeFile(specForName("a.csv"), "a,b\n1,2\n3,4")).toBe("3 rows · 2 columns");
    expect(describeFile(specForName("a.xlsx"), "--- sheet: A ---\nx\n--- sheet: B ---\ny\nz")).toBe("3 rows · 1 column · 2 sheets");
    expect(describeFile(specForName("a.docx"), "# One\ntext here\n## Two\nmore")).toBe("2 sections · 5 words");
    expect(describeFile(specForName("a.log"), "l1\nl2")).toBe("2 lines");
  });

  it("builds a CSV with the injection guard applied", async () => {
    const blob = await buildFile(specForName("out.csv"), "name,cmd\nx,=2+2\n");
    expect(blob.type).toBe("text/csv");
    expect(await blob.text()).toContain("'=2+2");
  });

  it("refuses a file over the size cap", async () => {
    await expect(buildFile(specForName("big.txt"), "x".repeat(2 * 1024 * 1024 + 1))).rejects.toBeInstanceOf(FileTooLargeError);
  });
});
