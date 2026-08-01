/**
 * Post-answer citation audit.
 *
 * The model is instructed to cite retrieved evidence as [n]. This module
 * checks the finished answer against the evidence package for that turn:
 *   - which indices were cited
 *   - which indices are invented / out of range
 *   - which claim-like sentences lack a nearby citation
 *
 * This is deterministic claim coverage, not an LLM verifier. It will not
 * catch every unsupported assertion, but it catches the common failure modes
 * (no citations at all, fake indices, bare claims beside unused sources).
 */

export type CitationAuditStatus =
  | "not_applicable" // retrieval/grounding not required for this turn
  | "declined"       // answer correctly admits the evidence does not cover the question
  | "grounded"       // claim-like sentences are cited with valid indices
  | "partial"        // some claims cited, some not
  | "uncited"        // evidence intentionally supplied but not cited on claims
  | "invalid"        // answer cites indices that were not provided
  | "insufficient_evidence"; // sought workspace evidence; none usable

export type CitationAudit = {
  status: CitationAuditStatus;
  citedIndices: number[];
  invalidIndices: number[];
  unusedIndices: number[];
  claimCount: number;
  citedClaimCount: number;
};

const CITATION_RE = /\[(\d+)\]/g;

/** True when the answer is opting out of grounded claims. */
export function admitsEvidenceGap(text: string): boolean {
  return (
    /lack(?:s)? sufficient evidence/i.test(text) ||
    /don'?t (?:have|see) (?:enough )?evidence/i.test(text) ||
    /(?:documents?|sources?|context) (?:do not|don't|does not|doesn't) cover/i.test(text) ||
    /no (?:retrieved )?evidence/i.test(text) ||
    /not enough (?:evidence|information|context)/i.test(text) ||
    /would need (?:more|additional) (?:evidence|detail|context|documents?)/i.test(text)
  );
}

/** Extract unique citation indices in order of first appearance. */
export function extractCitationIndices(text: string): number[] {
  const seen = new Set<number>();
  const ordered: number[] = [];
  CITATION_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CITATION_RE.exec(text)) !== null) {
    const n = Number(m[1]);
    if (!Number.isFinite(n) || n < 1) continue;
    if (!seen.has(n)) {
      seen.add(n);
      ordered.push(n);
    }
  }
  return ordered;
}

/**
 * Split into sentence-like units. Keeps citation markers attached to the
 * sentence they trail.
 */
export function splitClaimUnits(text: string): string[] {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return [];
  return cleaned
    .split(/(?<=[.!?])\s+(?=[A-Z\[])|\n+/)
    .map(s => s.trim())
    .filter(Boolean);
}

/** Heuristic: does this unit look like a factual claim that should be cited? */
export function isClaimLike(unit: string): boolean {
  const t = unit.trim();
  if (t.length < 28) return false;

  // Meta / process language
  if (/^(here'?s|based on|according to|from the|the (?:retrieved )?evidence|i (?:would|can) (?:need|help)|let me|note:)/i.test(t)) {
    // Still a claim if it asserts a concrete fact later — fall through only for short meta.
    if (t.length < 80 && !/\b(?:is|are|must|should|configured|timeout|policy|arn|region)\b/i.test(t)) {
      return false;
    }
  }

  if (admitsEvidenceGap(t) && t.length < 220) return false;

  // Questions to the user
  if (/\?\s*$/.test(t) && /^(what|which|who|where|when|how|can you|could you|do you)/i.test(t)) {
    return false;
  }

  // Imperative next-steps without asserting workspace facts
  if (/^(please |try |check |upload |provide |share )/i.test(t) && t.length < 100) {
    return false;
  }

  return true;
}

function unitHasValidCitation(unit: string, valid: Set<number>): boolean {
  CITATION_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CITATION_RE.exec(unit)) !== null) {
    const n = Number(m[1]);
    if (valid.has(n)) return true;
  }
  return false;
}

/**
 * Audit a finished assistant answer against the citation indices that were
 * offered in the prompt (typically `citations.map(c => c.index)`).
 */
export function auditCitations(
  answer: string,
  availableIndices: number[],
): CitationAudit {
  const available = [...new Set(availableIndices.filter(n => n >= 1))].sort((a, b) => a - b);

  if (available.length === 0) {
    return {
      status: "not_applicable",
      citedIndices: [],
      invalidIndices: [],
      unusedIndices: [],
      claimCount: 0,
      citedClaimCount: 0,
    };
  }

  const validSet = new Set(available);
  const mentioned = extractCitationIndices(answer);
  const citedIndices = mentioned.filter(n => validSet.has(n));
  const invalidIndices = mentioned.filter(n => !validSet.has(n));
  const unusedIndices = available.filter(n => !citedIndices.includes(n));

  if (admitsEvidenceGap(answer) && citedIndices.length === 0) {
    return {
      status: invalidIndices.length > 0 ? "invalid" : "declined",
      citedIndices,
      invalidIndices,
      unusedIndices,
      claimCount: 0,
      citedClaimCount: 0,
    };
  }

  const claims = splitClaimUnits(answer).filter(isClaimLike);
  const citedClaimCount = claims.filter(u => unitHasValidCitation(u, validSet)).length;
  const claimCount = claims.length;

  let status: CitationAuditStatus;
  if (invalidIndices.length > 0) {
    // Invented indices always surface as invalid, even if some claims are cited.
    status = "invalid";
  } else if (claimCount === 0) {
    status = citedIndices.length > 0 ? "grounded" : "uncited";
  } else if (citedClaimCount === 0) {
    status = "uncited";
  } else if (citedClaimCount < claimCount) {
    status = "partial";
  } else {
    status = "grounded";
  }

  return {
    status,
    citedIndices,
    invalidIndices,
    unusedIndices,
    claimCount,
    citedClaimCount,
  };
}
