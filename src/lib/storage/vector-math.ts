/**
 * Cosine ranking shared by the in-memory engine, Floci Query fallback,
 * and conversion of DynamoDB SearchVectors COSINE scores.
 *
 * AWS COSINE score: 0 = identical, 2 = opposite.
 * App similarity (higher = better): 1 - score, matching pgvector `1 - (<=>)`.
 */

export const VECTOR_SEARCH_TOPK_MAX = 100;

export function cosineSimilarity(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom === 0) return 0;
  const s = dot / denom;
  if (s > 1) return 1;
  if (s < -1) return -1;
  return s;
}

/** Convert unit-interval cosine similarity to the AWS COSINE distance score. */
export function cosineDistanceScore(similarity: number): number {
  return 1 - similarity;
}

/** Convert an AWS COSINE SearchVectors score to app similarity. */
export function similarityFromCosineScore(score: number): number {
  return 1 - score;
}

export function clampTopK(limit: number | undefined): number {
  const n = Number.isFinite(limit) ? Math.floor(limit as number) : 10;
  if (n < 1) return 1;
  return Math.min(n, VECTOR_SEARCH_TOPK_MAX);
}
