import { describe, expect, it } from "vitest";
import {
  clampTopK,
  cosineDistanceScore,
  cosineSimilarity,
  similarityFromCosineScore,
  VECTOR_SEARCH_TOPK_MAX,
} from "./vector-math";

describe("vector-math", () => {
  it("ranks identical unit vectors as similarity 1", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineDistanceScore(1)).toBeCloseTo(0);
    expect(similarityFromCosineScore(0)).toBeCloseTo(1);
  });

  it("maps opposite vectors to AWS COSINE score 2", () => {
    const sim = cosineSimilarity([1, 0], [-1, 0]);
    expect(sim).toBeCloseTo(-1);
    expect(cosineDistanceScore(sim)).toBeCloseTo(2);
    expect(similarityFromCosineScore(2)).toBeCloseTo(-1);
  });

  it("matches pgvector-style similarity 1 - score", () => {
    expect(similarityFromCosineScore(0.5)).toBeCloseTo(0.5);
  });

  it("caps TopK at the SearchVectors maximum", () => {
    expect(clampTopK(3)).toBe(3);
    expect(clampTopK(500)).toBe(VECTOR_SEARCH_TOPK_MAX);
    expect(clampTopK(0)).toBe(1);
  });
});
