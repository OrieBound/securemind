/**
 * Evidence packaging for chat turns — numbered sources for the model prompt
 * and citation metadata for the UI.
 *
 * Retrieved fragments are the only material answers should rest on for
 * workspace-specific claims. When none are available, the prompt must make
 * "insufficient evidence" cheaper than fabrication.
 */

import type { SemanticHit } from "@/lib/memory";

export type Citation = {
  /** 1-based index matching [n] markers in the prompt / answer. */
  index: number;
  fragmentId: string;
  category: string;
  /** Document filename when the fragment came from Knowledge; null for memory. */
  documentId: string | null;
  documentName: string | null;
  /** Short preview for the Sources strip — already sanitized at ingest. */
  preview: string;
  similarity: number;
};

const PREVIEW_LEN = 140;

function previewOf(content: string): string {
  const flat = content.replace(/\s+/g, " ").trim();
  if (flat.length <= PREVIEW_LEN) return flat;
  return `${flat.slice(0, PREVIEW_LEN - 1)}…`;
}

function sourceLabel(hit: SemanticHit): string {
  if (hit.documentName) return `document: ${hit.documentName}`;
  if (hit.category === "document") return "document chunk";
  if (hit.category === "semantic") return "workspace memory";
  return "prior exchange";
}

/**
 * Builds numbered citation records and the prompt block that lists them.
 * Indices are stable for the turn — the model is told to cite with [n].
 */
export function packageEvidence(hits: SemanticHit[]): {
  citations: Citation[];
  promptBlock: string;
} {
  if (hits.length === 0) {
    return { citations: [], promptBlock: "" };
  }

  const citations: Citation[] = hits.map((hit, i) => ({
    index: i + 1,
    fragmentId: hit.id,
    category: hit.category,
    documentId: hit.documentId ?? null,
    documentName: hit.documentName ?? null,
    preview: previewOf(hit.content),
    similarity: Number(hit.similarity),
  }));

  const lines = hits.map((hit, i) => {
    const n = i + 1;
    return `[${n}] (${sourceLabel(hit)}) ${hit.content}`;
  });

  const promptBlock =
    `\n\nRetrieved evidence (cite as [n] when you use a source):\n` +
    lines.join("\n") +
    `\n\nCitation rules:\n` +
    `- When a claim rests on a retrieved source, append the matching [n] after it.\n` +
    `- Do not invent source numbers. Only cite indices listed above.\n` +
    `- If the evidence only partially covers the question, say what is missing.`;

  return { citations, promptBlock };
}

/**
 * Extra system-prompt instruction when this turn has no retrieved evidence.
 * Skipped for trivial messages so greetings stay natural.
 */
export function insufficientEvidenceBlock(needsEvidence: boolean): string {
  if (!needsEvidence) return "";
  return (
    `\n\nNo retrieved evidence was found for this turn ` +
    `(no sufficiently similar document chunks or memory fragments).\n` +
    `If the question depends on workspace documents, runbooks, or prior ` +
    `investigations, say you lack sufficient evidence and name what would help ` +
    `(for example: which document to upload, or which system/env details). ` +
    `Do not invent specifics to fill the gap.`
  );
}

/**
 * Heuristic: does this user message look like it needs grounded evidence?
 * Trivial / micro turns (greetings, acks) should not force the insufficient-
 * evidence speech.
 */
export function messageNeedsEvidence(
  message: string,
  opts?: { isTrivial?: boolean },
): boolean {
  if (opts?.isTrivial) return false;
  const t = message.trim();
  if (t.length < 12) return false;
  // Short chitchat
  if (/^(hi|hello|hey|thanks|thank you|ok|okay|yes|no|yep|nope)\b/i.test(t) && t.length < 40) {
    return false;
  }
  return true;
}
