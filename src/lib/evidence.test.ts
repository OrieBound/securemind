import { describe, expect, it } from "vitest";
import { formatAttachmentsForHistory } from "./attachments";
import {
  insufficientEvidenceBlock,
  messageNeedsEvidence,
  packageCurrentAttachments,
  packageEvidence,
  withFileAccessTurnNudge,
} from "./evidence";
import type { SemanticHit } from "./memory";

describe("packageEvidence", () => {
  it("returns empty packaging when there are no hits", () => {
    expect(packageEvidence([])).toEqual({ citations: [], promptBlock: "" });
  });

  it("numbers document hits and excludes episodic prior-exchange fragments", () => {
    const hits: SemanticHit[] = [
      {
        id: "f1",
        content: "Rotate IAM keys every 90 days.",
        category: "document",
        similarity: 0.82,
        documentId: "d1",
        documentName: "iam-runbook.md",
      },
      {
        id: "f2",
        content: "Last incident involved expired session tokens.",
        category: "episodic",
        similarity: 0.71,
        documentId: null,
        documentName: null,
      },
    ];

    const { citations, promptBlock } = packageEvidence(hits);

    expect(citations).toHaveLength(1);
    expect(citations[0]).toMatchObject({
      index: 1,
      fragmentId: "f1",
      documentName: "iam-runbook.md",
    });
    expect(promptBlock).toContain('BEGIN_RETRIEVED_EVIDENCE source="document: iam-runbook.md"');
    expect(promptBlock).not.toContain("prior exchange");
    expect(promptBlock).toContain("cite as [n]");
    expect(promptBlock).toMatch(/untrusted data/i);
  });

  it("includes sheet-range provenance on the source label", () => {
    const hits: SemanticHit[] = [
      {
        id: "f3",
        content: "East=10; West=25",
        category: "document",
        similarity: 0.9,
        documentId: "d2",
        documentName: "sales.xlsx",
        provenance: { kind: "sheet", sheet: "Sales", range: "Sales!B12:F28" },
      },
    ];
    const { citations, promptBlock } = packageEvidence(hits);
    expect(citations[0]?.provenance?.range).toBe("Sales!B12:F28");
    expect(promptBlock).toContain("sales.xlsx (Sales!B12:F28)");
  });
});

describe("packageCurrentAttachments", () => {
  it("fences attached document text for the prompt", () => {
    const block = packageCurrentAttachments([
      { id: "d1", name: "nda.txt", content: "This Agreement is between Acme and Beta." },
    ]);
    expect(block).toContain('source="current attachment: nda.txt"');
    expect(block).toContain("This Agreement is between Acme and Beta.");
    expect(block).toMatch(/You received these files this turn/i);
    expect(block).toMatch(/\[category redacted\]/i);
  });

  it("formats history blocks for follow-up turns", () => {
    const hist = formatAttachmentsForHistory([
      { id: "d1", name: "nda.txt", content: "Confidential terms." },
    ]);
    expect(hist).toContain("[Attached document: nda.txt]");
    expect(hist).toContain("Confidential terms.");
  });
});

describe("messageNeedsEvidence", () => {
  it("skips trivial turns", () => {
    expect(messageNeedsEvidence("hello there", { isTrivial: true })).toBe(false);
  });

  it("skips short greetings", () => {
    expect(messageNeedsEvidence("thanks")).toBe(false);
    expect(messageNeedsEvidence("Hello there sir!")).toBe(false);
  });

  it("flags workspace-scoped ops questions", () => {
    expect(
      messageNeedsEvidence("What does our Cognito runbook say about session timeout?"),
    ).toBe(true);
  });

  it("skips general knowledge questions", () => {
    expect(messageNeedsEvidence("Tell me about lava.")).toBe(false);
    expect(messageNeedsEvidence("What is a black hole?")).toBe(false);
  });
});

describe("insufficientEvidenceBlock", () => {
  it("is empty when evidence was not sought", () => {
    expect(
      insufficientEvidenceBlock({
        soughtEvidence: false,
        requiresWorkspaceEvidence: false,
      }),
    ).toBe("");
  });

  it("instructs the model not to invent when workspace evidence is required", () => {
    const block = insufficientEvidenceBlock({
      soughtEvidence: true,
      requiresWorkspaceEvidence: true,
    });
    expect(block).toMatch(/Do not say that Knowledge/i);
    expect(block).toMatch(/Do not invent/i);
    expect(block).toMatch(/cannot view attachments/i);
  });
});

describe("withFileAccessTurnNudge", () => {
  it("appends the recency instruction only when excerpts are present", () => {
    expect(withFileAccessTurnNudge("What did you receive?", false)).toBe("What did you receive?");
    const nudged = withFileAccessTurnNudge("What did you receive?", true);
    expect(nudged).toContain("What did you receive?");
    expect(nudged).toMatch(/Never say you cannot view or access attachments/);
  });
});
