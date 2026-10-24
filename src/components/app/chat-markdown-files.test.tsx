/**
 * @vitest-environment happy-dom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ChatMarkdown } from "@/components/app/chat-markdown";

afterEach(cleanup);

const closed = "Preparing your file.\n\n```file:stock.csv\nitem,qty\nbolts,120\n```\n\nDone.";
const open = "Preparing your file.\n\n```file:stock.csv\nitem,qty\nbolts,120\n";

describe("file blocks in chat", () => {
  it("shows a file card instead of a code block, with a summary and Download", () => {
    render(<ChatMarkdown content={closed} />);
    expect(screen.getByText("stock.csv")).toBeTruthy();
    expect(screen.getByText(/CSV spreadsheet · 2 rows · 2 columns/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Download$/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /copy code/i })).toBeNull();
  });

  it("waits while the block is still streaming", () => {
    render(<ChatMarkdown content={open} streaming />);
    expect(screen.getByText(/Preparing file/)).toBeTruthy();
    expect((screen.getByRole("button", { name: /Download/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("marks a cut-off file as incomplete and points to Continue", () => {
    render(<ChatMarkdown content={open} truncated />);
    expect(screen.getByRole("button", { name: /Download partial/ })).toBeTruthy();
    expect(screen.getByText(/Choose Continue/)).toBeTruthy();
  });

  it("is ready once the reply has finished, even without a closing fence", () => {
    render(<ChatMarkdown content={open} />);
    expect((screen.getByRole("button", { name: /^Download$/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("keeps ordinary code blocks, now with Download next to Copy", () => {
    render(<ChatMarkdown content={"```bash\nnpm run dev\n```"} />);
    expect(screen.getByRole("button", { name: /copy code/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /download code/i })).toBeTruthy();
  });

  it("puts CSV and Excel buttons on tables", () => {
    render(<ChatMarkdown content={"| a | b |\n| - | - |\n| 1 | 2 |"} />);
    expect(screen.getByRole("button", { name: "CSV" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Excel" })).toBeTruthy();
  });

  it("saves an unsafe file type as text and says so", () => {
    render(<ChatMarkdown content={"```file:setup.bat\necho hi\n```"} />);
    expect(screen.getByText("setup.bat.txt")).toBeTruthy();
    expect(screen.getByText(/Saved as .txt/)).toBeTruthy();
  });
});
