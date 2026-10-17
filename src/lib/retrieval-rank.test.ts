import { describe, expect, it } from "vitest";
import {
  CANDIDATE_VECTOR_FLOOR,
  GROUNDED_MIN_SCORE,
  SPECULATIVE_MIN_SCORE,
  fuseScore,
  hitScore,
  lexicalCoverage,
  queryTerms,
  rankHits,
  strongHits,
} from "./retrieval-rank";

describe("queryTerms", () => {
  it("drops stopwords and short words, folds plurals, and de-duplicates", () => {
    expect(queryTerms("How much is the storage locker?")).toEqual(["storage", "locker"]);
    expect(queryTerms("parking parkings")).toEqual(["parking"]);
    expect(queryTerms("late fee")).toEqual(["late", "fee"]);
    expect(queryTerms("What is it?")).toEqual([]);
  });
});

describe("lexicalCoverage", () => {
  it("counts whole words, including hyphen-split tokens", () => {
    expect(lexicalCoverage(["late", "fee"], "Late-payment test code LATE-FEE-DEMO-25")).toBe(1);
    expect(lexicalCoverage(["late", "fee"], "Late-payment code")).toBe(0.5);
    expect(lexicalCoverage(["park"], "parking stall")).toBe(0);
    expect(lexicalCoverage([], "anything")).toBe(0);
  });
});

describe("rankHits", () => {
  const hits = [
    { id: "a", similarity: 0.45, content: "Parking $125.00 CAD per month - Stall P2-117" },
    { id: "b", similarity: 0.52, content: "Governing law: Province of Ontario" },
    { id: "c", similarity: 0.33, content: "Unrelated boilerplate text" },
  ];

  it("lifts a keyword match above a better vector score, and drops weak noise", () => {
    const ranked = rankHits(hits, "parking", 10);
    expect(ranked.map(h => h.id)).toEqual(["a", "b"]);
    expect(ranked[0].score).toBeCloseTo(fuseScore(0.45, 1), 6);
    expect(ranked[0].similarity).toBe(0.45);
  });

  it("respects the limit and never returns a hit under the grounded floor", () => {
    expect(rankHits(hits, "parking", 1)).toHaveLength(1);
    for (const h of rankHits(hits, "nothing matches here", 10)) {
      expect(h.score).toBeGreaterThanOrEqual(GROUNDED_MIN_SCORE);
    }
    expect(rankHits(hits, "parking", 0)).toEqual([]);
  });
});

describe("thresholds", () => {
  it("orders the floors noise < grounded < speculative", () => {
    expect(CANDIDATE_VECTOR_FLOOR).toBeLessThan(GROUNDED_MIN_SCORE);
    expect(GROUNDED_MIN_SCORE).toBeLessThan(SPECULATIVE_MIN_SCORE);
  });

  it("uses the fused score when present and raw similarity otherwise", () => {
    expect(hitScore({ similarity: 0.4, score: 0.6 })).toBe(0.6);
    expect(hitScore({ similarity: 0.4 })).toBe(0.4);
  });

  it("keeps only strong hits for upgrading a general question", () => {
    const kept = strongHits([
      { id: "x", similarity: 0.52 },
      { id: "y", similarity: 0.4, score: 0.58 },
      { id: "z", similarity: 0.6 },
    ]);
    expect(kept.map(h => h.id)).toEqual(["y", "z"]);
  });
});
