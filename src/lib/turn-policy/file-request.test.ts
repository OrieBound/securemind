import { describe, expect, it } from "vitest";
import { detectFileRequest, fileOutputInstructions, resolveFileRequest } from "./file-request";

describe("detectFileRequest", () => {
  it.each([
    ["Export the steps above as a Word document", "docx"],
    ["give me this table as Excel", "xlsx"],
    ["Can you put that into a spreadsheet?", "xlsx"],
    ["make a CSV file of the open incidents", "csv"],
    ["Send me a CSV of the results", "csv"],
    ["write a sample nginx error log as a .log file", "log"],
    ["save it as app.log", "log"],
    ["generate report.xlsx with two sheets", "xlsx"],
    ["Create a markdown file with the checklist", "md"],
    ["convert this to json", "json"],
    ["Please export that to CSV", "csv"],
    ["draft the onboarding guide in Word format", "docx"],
  ])("asks for a file: %s", (message, ext) => {
    expect(detectFileRequest(message)).toEqual({ ext });
  });

  it("accepts a request without a format", () => {
    expect(detectFileRequest("can you give me that as a file?")).toEqual({ ext: null });
    expect(detectFileRequest("create a downloadable file with these notes")).toEqual({ ext: null });
  });

  it.each([
    "file a bug for the login page",
    "the log says connection refused, why?",
    "how do I log in to the console?",
    "summarize the CSV I uploaded",
    "give me a summary of the attached spreadsheet",
    "what does this Excel sheet show?",
    "write a short note about Excel shortcuts",
    "make sure the document is accurate",
    "what's the difference between CSV and JSON?",
    "",
  ])("does not treat this as a file request: %s", message => {
    expect(detectFileRequest(message)).toBeNull();
  });
});

describe("fileOutputInstructions", () => {
  it("explains the file: block and names the format", () => {
    const text = fileOutputInstructions({ ext: "xlsx" });
    expect(text).toContain("file:<name.ext>");
    expect(text).toContain("Make it a .xlsx file");
    expect(text).toContain("--- sheet: Name ---");
    expect(text).toContain("never guess the original value");
  });

  it("leaves the format to the model when none was named", () => {
    expect(fileOutputInstructions({ ext: null })).not.toContain("Make it a .");
  });
});

describe("resolveFileRequest", () => {
  const asked = [
    { role: "user", content: "Are you able to create me a text file, please, with some columns and rows?" },
    { role: "assistant", content: "Sure! Which column headings would you like, and how many rows?" },
  ];

  it("carries a file request into the answer to the assistant's question", () => {
    expect(resolveFileRequest("Let's say five columns, five rows. You randomize the data, please.", asked)).toEqual({ ext: "txt" });
  });

  const delivered = [asked[0], { role: "assistant", content: "Here it is.\n\n```file:data.txt\na,b\n```" }];

  it("does not make another file for thanks or a question about the delivered one", () => {
    expect(resolveFileRequest("thanks, looks good", delivered)).toBeNull();
    expect(resolveFileRequest("what does the second column mean?", delivered)).toBeNull();
    expect(resolveFileRequest("Why are there only two rows?", delivered)).toBeNull();
  });

  it("revises the delivered file when asked for a change, keeping its type", () => {
    expect(resolveFileRequest("Let's say five columns, five rows. You randomize the data, please.", delivered)).toEqual({ ext: "txt" });
    expect(resolveFileRequest("add a column for the owner", delivered)).toEqual({ ext: "txt" });
    expect(resolveFileRequest("make it 10 rows instead", delivered)).toEqual({ ext: "txt" });
  });

  it("does not inherit from an older, unrelated exchange", () => {
    expect(resolveFileRequest("what's the weather like?", [{ role: "user", content: "hello" }, { role: "assistant", content: "Hi!" }])).toBeNull();
  });

  it("prefers a request in the current message", () => {
    expect(resolveFileRequest("actually make it an Excel file", asked)).toEqual({ ext: "xlsx" });
  });
});
