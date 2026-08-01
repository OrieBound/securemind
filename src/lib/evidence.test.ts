import { describe, expect, it } from "vitest";
import {
  insufficientEvidenceBlock,
  messageNeedsEvidence,
  packageEvidence,
} from "./evidence";
import type { SemanticHit } from "./memory";

describe("packageEvidence", () => {
  it("returns empty packaging when there are no hits", () => {
    expect(packageEvidence([])).toEqual({ citations: [], promptBlock: "" });
  });

  it("numbers hits and includes citation rules in the prompt block", () => {
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

    expect(citations).toHaveLength(2);
    expect(citations[0]).toMatchObject({
      index: 1,
      fragmentId: "f1",
      documentName: "iam-runbook.md",
    });
    expect(citations[1].index).toBe(2);
    expect(promptBlock).toContain("[1] (document: iam-runbook.md)");
    expect(promptBlock).toContain("[2] (prior exchange)");
    expect(promptBlock).toContain("cite as [n]");
  });
});

describe("messageNeedsEvidence", () => {
  it("skips trivial turns", () => {
    expect(messageNeedsEvidence("hello there", { isTrivial: true })).toBe(false);
  });

  it("skips short greetings", () => {
    expect(messageNeedsEvidence("thanks")).toBe(false);
  });

  it("flags ops questions", () => {
    expect(
      messageNeedsEvidence("What is the session timeout for production Cognito?"),
    ).toBe(true);
  });
});

describe("insufficientEvidenceBlock", () => {
  it("is empty when evidence is not required", () => {
    expect(insufficientEvidenceBlock(false)).toBe("");
  });

  it("instructs the model not to invent when evidence is required", () => {
    const block = insufficientEvidenceBlock(true);
    expect(block).toMatch(/lack sufficient evidence/i);
    expect(block).toMatch(/Do not invent/i);
  });
});
