import { describe, expect, it } from "vitest";
import {
  admitsEvidenceGap,
  auditCitations,
  extractCitationIndices,
  isClaimLike,
  splitClaimUnits,
} from "./citation-audit";

describe("extractCitationIndices", () => {
  it("returns unique indices in first-seen order", () => {
    expect(extractCitationIndices("A [2] then [1] then [2] again.")).toEqual([2, 1]);
  });

  it("ignores non-numeric brackets", () => {
    expect(extractCitationIndices("see [n] and [12]")).toEqual([12]);
  });
});

describe("admitsEvidenceGap", () => {
  it("detects insufficient-evidence language", () => {
    expect(admitsEvidenceGap("I lack sufficient evidence in the uploaded documents.")).toBe(true);
  });

  it("is false for ordinary grounded answers", () => {
    expect(admitsEvidenceGap("Session timeout is 60 minutes [1].")).toBe(false);
  });
});

describe("claim units", () => {
  it("splits on sentence boundaries", () => {
    const units = splitClaimUnits("First claim ends. Second claim follows [1].");
    expect(units.length).toBeGreaterThanOrEqual(2);
  });

  it("treats a concrete ops assertion as claim-like", () => {
    expect(
      isClaimLike("Production Cognito sessions expire after 60 minutes of idle time."),
    ).toBe(true);
  });

  it("does not treat a short ask as claim-like", () => {
    expect(isClaimLike("Can you upload the runbook?")).toBe(false);
  });
});

describe("auditCitations", () => {
  it("returns not_applicable when no evidence was offered", () => {
    const audit = auditCitations("Anything.", []);
    expect(audit.status).toBe("not_applicable");
  });

  it("marks a fully cited answer as grounded", () => {
    const answer =
      "Idle sessions expire after 60 minutes [1]. " +
      "Refresh tokens last 30 days [2].";
    const audit = auditCitations(answer, [1, 2]);
    expect(audit.status).toBe("grounded");
    expect(audit.citedIndices).toEqual([1, 2]);
    expect(audit.invalidIndices).toEqual([]);
    expect(audit.citedClaimCount).toBe(audit.claimCount);
  });

  it("marks inventing source numbers as invalid", () => {
    const audit = auditCitations("Timeout is 60 minutes [9].", [1, 2]);
    expect(audit.status).toBe("invalid");
    expect(audit.invalidIndices).toEqual([9]);
  });

  it("marks evidence-backed turns with no citations as uncited", () => {
    const audit = auditCitations(
      "Production Cognito sessions expire after 60 minutes of idle time in this environment.",
      [1],
    );
    expect(audit.status).toBe("uncited");
    expect(audit.citedIndices).toEqual([]);
  });

  it("marks mixed coverage as partial", () => {
    const answer =
      "Idle timeout is 60 minutes [1]. " +
      "Token refresh uses a custom Lambda authorizer in us-east-1 without a source marker.";
    const audit = auditCitations(answer, [1, 2]);
    expect(audit.status).toBe("partial");
    expect(audit.citedIndices).toEqual([1]);
    expect(audit.citedClaimCount).toBeLessThan(audit.claimCount);
  });

  it("accepts an explicit evidence-gap decline", () => {
    const audit = auditCitations(
      "I lack sufficient evidence in the workspace documents to answer the retention question.",
      [1, 2],
    );
    expect(audit.status).toBe("declined");
  });

  it("lists unused sources when only some are cited", () => {
    const audit = auditCitations("Timeout is 60 minutes [1].", [1, 2, 3]);
    expect(audit.unusedIndices).toEqual([2, 3]);
  });
});
