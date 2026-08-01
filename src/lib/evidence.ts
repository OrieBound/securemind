/**
 * Evidence packaging for chat turns — numbered sources for the model prompt
 * and citation metadata for the UI.
 *
 * Retrieved fragments are the only material answers should rest on for
 * workspace-specific claims. When none are available, the prompt must make
 * "insufficient evidence" cheaper than fabrication.
 */

import type { SemanticHit } from "@/lib/memory";
import { EVIDENCE_PROMPT_LIMIT } from "@/lib/memory";
import { fenceRetrievedChunk, untrustedEvidenceRules } from "@/lib/prompt-guard";
import { decideTurn } from "@/lib/turn-policy/decide-turn";

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
 * Select prompt evidence from retrieval candidates: threshold already applied
 * by retrieveSemanticMemory; prefer diverse documents and cap count.
 */
export function selectEvidenceForPrompt(
  hits: SemanticHit[],
  limit = EVIDENCE_PROMPT_LIMIT,
): SemanticHit[] {
  const selected: SemanticHit[] = [];
  const docCounts = new Map<string, number>();

  for (const hit of hits) {
    if (selected.length >= limit) break;
    if (hit.documentId) {
      const n = docCounts.get(hit.documentId) ?? 0;
      if (n >= 2) continue;
      docCounts.set(hit.documentId, n + 1);
    }
    selected.push(hit);
  }
  return selected;
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

  const lines = hits.map((hit, i) =>
    fenceRetrievedChunk(i + 1, sourceLabel(hit), hit.content),
  );

  const promptBlock =
    `\n\nRetrieved evidence (cite as [n] when you use a source):` +
    untrustedEvidenceRules() +
    `\n\n` +
    lines.join("\n\n") +
    `\n\nCitation rules:\n` +
    `- When a claim rests on a retrieved source, append the matching [n] after that claim.\n` +
    `- Do not invent source numbers. Only cite indices listed above.\n` +
    `- Prefer one citation per factual sentence that draws on the evidence.\n` +
    `- If the evidence only partially covers the question, say what is missing.\n` +
    `- Your answer will be checked for missing or invented citations.\n` +
    `- Never narrate the retrieval process to the user.`;

  return { citations, promptBlock };
}

/**
 * Extra system-prompt instruction when workspace evidence was sought but none
 * was relevant. Skipped for social / general / app-help turns.
 */
export function insufficientEvidenceBlock(opts: {
  soughtEvidence: boolean;
  requiresWorkspaceEvidence: boolean;
}): string {
  if (!opts.soughtEvidence) return "";
  if (opts.requiresWorkspaceEvidence) {
    return (
      `\n\nNo sufficiently relevant workspace Knowledge was found for this turn.\n` +
      `Say that the available workspace Knowledge does not support a confident answer, ` +
      `name what would help (document, log, or detail), and do not invent a cause.\n` +
      `You may offer clearly labeled general guidance separately from workspace facts.\n` +
      `Do not cite unrelated material.`
    );
  }
  return (
    `\n\nNo sufficiently relevant workspace Knowledge was retrieved for this turn.\n` +
    `You may answer with general guidance when appropriate, but do not imply it ` +
    `came from this workspace's documents. Do not invent workspace-specific facts.`
  );
}

/**
 * @deprecated Prefer decideTurn(). Delegates to turn policy for compatibility.
 */
export function messageNeedsEvidence(
  message: string,
  opts?: { isTrivial?: boolean },
): boolean {
  if (opts?.isTrivial) return false;
  const d = decideTurn({ message });
  return d.shouldRetrieve || d.requiresWorkspaceEvidence;
}
