import { describe, expect, it } from "vitest";
import { applyFileFallback } from "./fallback";
import { parseFileInfo } from "./file-spec";

const F = "```";

/** The first file block in a rewritten reply: its name and body. */
function fileBlock(content: string) {
  const m = /^(`{3,}|~{3,})file:([^\n]+)\n([\s\S]*?)\n\1\s*$/m.exec(content);
  return m ? { name: m[2].trim(), body: m[3] } : null;
}

const countriesCsv = "Country,Capital,Population\nJapan,Tokyo,124500000\nBrazil,Brasília,216400000\nIceland,Reykjavik,390000";

describe("applyFileFallback: your countries example", () => {
  const reply = [
    "Here is a CSV dataset you can easily paste into a text editor, save as `.csv`, and open right in Excel.",
    "",
    F + "csv",
    countriesCsv,
    F,
    "",
    "Quick reminder on how to get this into Excel:",
    "",
    "1. Copy the code block above.",
    "2. Paste it into Notepad, TextEdit, or any plain text editor.",
    "3. Save the file as `countries.csv`.",
    "",
    "Want me to add more countries?",
  ].join("\n");

  it("turns the CSV block into an Excel file card and drops the copy-and-paste steps", () => {
    const r = applyFileFallback(reply, { ext: "xlsx" });
    expect(r).toMatchObject({ changed: true, source: "csv-block" });
    const f = fileBlock(r.content)!;
    expect(f.name).toBe("data.xlsx");
    expect(f.body).toBe(countriesCsv);
    expect(parseFileInfo(`file:${f.name}`)?.kind).toBe("xlsx");
    expect(r.content).toContain("Want me to add more countries?");
    expect(r.content).not.toMatch(/Notepad|Copy the code block/);
  });

  it("makes a CSV when CSV was asked for", () => {
    expect(fileBlock(applyFileFallback(reply, { ext: "csv" }).content)?.name).toBe("data.csv");
  });
});

describe("applyFileFallback: other shapes", () => {
  it("turns a Markdown table into a spreadsheet", () => {
    const r = applyFileFallback("Here you go:\n\n| City | Pop |\n| --- | --- |\n| Paris | 2.1M |\n| Rome | 2.8M |\n\nEnjoy!", { ext: "xlsx" });
    expect(r.source).toBe("table");
    expect(fileBlock(r.content)).toEqual({ name: "table.xlsx", body: "City,Pop\nParis,2.1M\nRome,2.8M" });
    expect(r.content).toContain("Enjoy!");
  });

  it("turns a structured Markdown reply into a Word document", () => {
    const doc = "# Onboarding\n\nWelcome.\n\n## Day one\n- Get a badge\n- Meet the team\n- Set up email\n\n## Day two\n1. Read the handbook\n2. Shadow a teammate\n" + "More detail here. ".repeat(10);
    const r = applyFileFallback(doc, { ext: "docx" });
    expect(r).toMatchObject({ changed: true, source: "document" });
    expect(fileBlock(r.content)?.name).toBe("document.docx");
    expect(fileBlock(r.content)?.body).toContain("## Day one");
  });

  it("uses a Markdown code block as the document when there is one", () => {
    const r = applyFileFallback("Paste this into Word:\n\n" + F + "markdown\n# Title\n\nBody text\n" + F + "\n", { ext: "docx" });
    expect(r.source).toBe("text-block");
    expect(fileBlock(r.content)?.name).toBe("document.docx");
  });

  it("keeps nested code fences inside a whole-reply document intact", () => {
    const doc = "# Guide\n\n## Setup\nRun:\n\n" + F + "bash\nnpm install\n" + F + "\n\n## Next\n- one\n- two\n- three\n" + "Padding text. ".repeat(20);
    const r = applyFileFallback(doc, { ext: "docx" });
    expect(r.changed).toBe(true);
    expect(r.content.startsWith("````file:document.docx")).toBe(true);
    expect(r.content.trimEnd().endsWith("````")).toBe(true);
  });

  it("picks the JSON block for a JSON file", () => {
    const r = applyFileFallback("Here is the catalog:\n\n" + F + "json\n[{\"id\":1}]\n" + F + "\n", { ext: "json" });
    expect(fileBlock(r.content)).toEqual({ name: "output.json", body: "[{\"id\":1}]" });
  });

  it("makes a log file from the only code block", () => {
    const r = applyFileFallback("Sample:\n\n" + F + "\n2026/10/24 [error] connect() failed\n" + F + "\n", { ext: "log" });
    expect(fileBlock(r.content)?.name).toBe("output.log");
  });
});

describe("applyFileFallback: leaves things alone", () => {
  const csvReply = "Here:\n\n" + F + "csv\na,b\n1,2\n" + F + "\n";

  it("does nothing without a file request", () => {
    expect(applyFileFallback(csvReply, null).changed).toBe(false);
  });

  it("does nothing when the model already used a file block", () => {
    const done = "Preparing.\n\n" + F + "file:x.csv\na,b\n1,2\n" + F + "\n";
    expect(applyFileFallback(done, { ext: "csv" }).changed).toBe(false);
  });

  it("does nothing when the reply was cut off inside a block", () => {
    expect(applyFileFallback("Here:\n\n" + F + "csv\na,b\n1,2\n", { ext: "csv" }).changed).toBe(false);
  });

  it("does not turn a refusal or a short answer into a file", () => {
    expect(applyFileFallback("I can't attach files, but I can describe the data.", { ext: "xlsx" }).changed).toBe(false);
    expect(applyFileFallback("Sure, which columns do you want?", { ext: "docx" }).changed).toBe(false);
  });

  it("does not treat a one-column list or code as a spreadsheet", () => {
    expect(applyFileFallback("Names:\n\n" + F + "csv\nAda\nGrace\nLinus\n" + F + "\n", { ext: "csv" }).changed).toBe(false);
    expect(applyFileFallback("Run:\n\n" + F + "bash\nnpm run dev\n" + F + "\n", { ext: "xlsx" }).changed).toBe(false);
  });
});
