/**
 * Hybrid ranking for Knowledge retrieval: vector similarity plus a small keyword bonus.
 *
 * Pure functions, no I/O, so both storage backends (Postgres/pgvector and DynamoDB)
 * rank the same way and the rules can be tested without a model.
 *
 * Why this exists: a fixed vector floor of 0.5 dropped the correct passage for roughly
 * a third of real questions ("storage locker" scored 0.48, "late fee" 0.40) and no single
 * number separates a weak real match from an unrelated question. Instead we fetch a wider
 * candidate set, reward literal term overlap, and use two thresholds that depend on how
 * sure we already are that the user is asking about their documents.
 */

/** Vector similarity below this is never a candidate (noise floor). */
export const CANDIDATE_VECTOR_FLOOR = 0.3;

/**
 * Minimum fused score for evidence on a turn already known to be about the workspace
 * (named a document, follow-up, investigation). The user's intent supplies the confidence.
 */
export const GROUNDED_MIN_SCORE = 0.4;

/**
 * Minimum fused score before a general question is upgraded to a Knowledge-grounded
 * turn. Higher, because nothing but the match itself says the user meant their files.
 */
export const SPECULATIVE_MIN_SCORE = 0.55;

/** Largest bonus a perfect keyword match can add to the vector similarity. */
export const LEXICAL_WEIGHT = 0.12;

/** Candidates fetched per requested hit, so keyword matches outside the vector top-N still surface. */
export const CANDIDATE_OVERFETCH = 3;

const STOPWORDS = new Set([
  "the", "and", "for", "are", "was", "were", "you", "your", "with", "this", "that", "what", "which",
  "who", "whom", "whose", "when", "where", "why", "how", "does", "did", "can", "could", "would",
  "should", "will", "has", "have", "had", "per", "much", "many", "any", "all", "from", "into", "about",
  "there", "their", "them", "then", "than", "its", "our", "out", "not", "but", "get", "got", "tell",
  "please", "give", "show", "list", "amount", "say", "said", "also", "need", "want", "like",
]);

/** Lowercase, split on non-alphanumerics, drop short words and stopwords, light plural folding. */
export function queryTerms(text: string): string[] {
  const seen = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 3 || STOPWORDS.has(raw)) continue;
    seen.add(foldPlural(raw));
  }
  return [...seen];
}

function foldPlural(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/** Fraction (0–1) of distinct query terms that appear as whole words in `content`. */
export function lexicalCoverage(terms: string[], content: string): number {
  if (terms.length === 0) return 0;
  const words = new Set<string>();
  for (const raw of content.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length >= 2) words.add(foldPlural(raw));
  }
  let found = 0;
  for (const term of terms) if (words.has(term)) found++;
  return found / terms.length;
}

export function fuseScore(vectorSimilarity: number, lexical: number): number {
  return vectorSimilarity + LEXICAL_WEIGHT * lexical;
}

type Rankable = { similarity: number; content: string };

/**
 * Score every candidate, drop anything under the grounded floor, and sort best-first.
 * `similarity` stays the raw vector similarity; `lexical` and `score` are added.
 */
export function rankHits<T extends Rankable>(
  hits: T[],
  query: string,
  limit: number,
): Array<T & { lexical: number; score: number }> {
  const terms = queryTerms(query);
  return hits
    .map(hit => {
      const lexical = lexicalCoverage(terms, hit.content);
      return { ...hit, lexical, score: fuseScore(hit.similarity, lexical) };
    })
    .filter(hit => hit.score >= GROUNDED_MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(0, limit));
}

/** The score a hit is judged on; older hits without one fall back to raw similarity. */
export function hitScore(hit: { similarity: number; score?: number }): number {
  return hit.score ?? hit.similarity;
}

/** Keep only hits strong enough to justify treating a general question as document-grounded. */
export function strongHits<T extends { similarity: number; score?: number }>(hits: T[]): T[] {
  return hits.filter(hit => hitScore(hit) >= SPECULATIVE_MIN_SCORE);
}
