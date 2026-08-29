import { describe, expect, it } from "vitest";
import { knowledgeLibraryKind } from "./knowledge-detail";

describe("knowledgeLibraryKind", () => {
  it("classifies documents, spreadsheets, and images", () => {
    expect(knowledgeLibraryKind("application/pdf")).toBe("documents");
    expect(knowledgeLibraryKind("text/csv")).toBe("spreadsheets");
    expect(knowledgeLibraryKind("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBe("spreadsheets");
    expect(knowledgeLibraryKind("image/png")).toBe("images");
  });
});
