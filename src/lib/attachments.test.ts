import { describe, expect, it } from "vitest";
import {
  attachedDocumentNamesFromText,
  formatAttachmentsForHistory,
  stripAttachedDocumentBlock,
  withAttachmentNamesInQuery,
} from "./attachments";

describe("attached document history labels", () => {
  it("extracts filenames from history blocks", () => {
    const hist = formatAttachmentsForHistory([
      { id: "d1", name: "service-agreement.pdf", content: "Control line." },
    ]);
    expect(attachedDocumentNamesFromText(`Please review.\n\n${hist}`)).toEqual([
      "service-agreement.pdf",
    ]);
  });

  it("hides the extract from the visible bubble and keeps the user's words", () => {
    const hist = formatAttachmentsForHistory([
      { id: "d1", name: "service-agreement.pdf", content: "Control line." },
    ]);
    expect(stripAttachedDocumentBlock(`Please review.\n\n${hist}`)).toBe("Please review.");
    expect(stripAttachedDocumentBlock(hist)).toBe("");
  });

  it("appends filenames to a retrieval query once", () => {
    expect(withAttachmentNamesInQuery("the document", ["service-agreement.pdf"])).toBe(
      "the document\nservice-agreement.pdf",
    );
    expect(
      withAttachmentNamesInQuery("service-agreement.pdf summary", ["service-agreement.pdf"]),
    ).toBe("service-agreement.pdf summary");
  });
});
