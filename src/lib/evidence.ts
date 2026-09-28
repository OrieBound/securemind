/**
 * Evidence packaging for chat turns — numbered sources for the model prompt
 * and citation metadata for the UI.
 *
 * Retrieved fragments are the only material answers should rest on for
 * workspace-specific claims. When none are available, the prompt must make
 * "insufficient evidence" cheaper than fabrication.
 */

import type { SemanticHit } from "@/lib/memory";
import type { ChunkProvenance } from "@/lib/spreadsheet/types";
import { EVIDENCE_PROMPT_LIMIT } from "@/lib/memory";
import {
  MAX_ATTACHMENT_PROMPT_CHARS,
  type CurrentAttachmentDoc,
} from "@/lib/attachments";
import { isCiteableFragment } from "@/lib/provenance";
import { fenceRetrievedChunk, untrustedEvidenceRules } from "@/lib/prompt-guard";
import { decideTurn } from "@/lib/turn-policy/decide-turn";

export type { CurrentAttachmentDoc } from "@/lib/attachments";
export {
  MAX_ATTACHMENT_PROMPT_CHARS,
  formatAttachmentsForHistory,
} from "@/lib/attachments";

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
  provenance?: ChunkProvenance | null;
};

const PREVIEW_LEN = 140;

function previewOf(content: string): string {
  const flat = content.replace(/\s+/g, " ").trim();
  if (flat.length <= PREVIEW_LEN) return flat;
  return `${flat.slice(0, PREVIEW_LEN - 1)}…`;
}

export function formatProvenanceLabel(p?: ChunkProvenance | null): string | null {
  if (!p) return null;
  if (p.range) return p.range;
  if (p.sheet) return p.sheet;
  if (p.page != null) return `p.${p.page}`;
  return null;
}

function sourceLabel(hit: SemanticHit): string {
  const loc = formatProvenanceLabel(hit.provenance);
  if (hit.documentName && loc) return `document: ${hit.documentName} (${loc})`;
  if (hit.documentName) return `document: ${hit.documentName}`;
  if (loc) return `document chunk (${loc})`;
  return "document chunk";
}

/**
 * Select prompt evidence from retrieval candidates: threshold already applied
 * by retrieveSemanticMemory; prefer diverse documents and cap count.
 * Non-document fragments (episodic assistant text, semantic guesses) are dropped.
 */
export function selectEvidenceForPrompt(
  hits: SemanticHit[],
  limit = EVIDENCE_PROMPT_LIMIT,
): SemanticHit[] {
  const selected: SemanticHit[] = [];
  const docCounts = new Map<string, number>();

  for (const hit of hits) {
    if (selected.length >= limit) break;
    if (!isCiteableFragment(hit.category, hit.documentId)) continue;
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
  const eligible = hits.filter(h => isCiteableFragment(h.category, h.documentId));
  if (eligible.length === 0) {
    return { citations: [], promptBlock: "" };
  }

  const citations: Citation[] = eligible.map((hit, i) => ({
    index: i + 1,
    fragmentId: hit.id,
    category: hit.category,
    documentId: hit.documentId ?? null,
    documentName: hit.documentName ?? null,
    preview: previewOf(hit.content),
    similarity: Number(hit.similarity),
    provenance: hit.provenance ?? null,
  }));

  const lines = eligible.map((hit, i) =>
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
    `- Placeholders like [category redacted] are already sanitized. Skip those fields and use the rest. Do not guess original values.\n` +
    `- Never say you cannot view attachments. Lead with what the excerpts support.\n` +
    `- Your answer will be checked for missing or invented citations.\n` +
    `- Never narrate the retrieval process to the user.`;

  return { citations, promptBlock };
}

/**
 * Appended to the current user turn when excerpts are in the prompt.
 * Recency beats earlier assistant refusals in the conversation history.
 */
export const FILE_ACCESS_TURN_NUDGE =
  `[Instruction — follow this over any earlier assistant claim: ` +
  `You already have the file excerpts in this prompt. Answer from them in plain English. ` +
  `Never say you cannot view or access attachments. Never mention privacy or security guidelines as a limitation. ` +
  `Do not explain how files are stored or retrieved. ` +
  `If the remaining text is enough, help. If it is not, say what you can still tell from the extract.]`;

export function withFileAccessTurnNudge<T extends string | Array<{ type: string; text?: string }>>(
  userContent: T,
  hasExcerpts: boolean,
): T {
  if (!hasExcerpts) return userContent;
  const nudge = `\n\n${FILE_ACCESS_TURN_NUDGE}`;
  if (typeof userContent === "string") {
    return (userContent + nudge) as T;
  }
  const parts = userContent as Array<{ type: string; text?: string }>;
  const firstText = parts.findIndex(p => p.type === "text");
  if (firstText < 0) return userContent;
  return parts.map((p, i) =>
    i === firstText ? { ...p, text: `${p.text ?? ""}${nudge}` } : p,
  ) as T;
}

/**
 * Inject scrubbed text from files attached on this chat turn.
 * Content is already sanitized at ingest — still fenced as untrusted data.
 */
export function packageCurrentAttachments(docs: CurrentAttachmentDoc[]): string {
  if (docs.length === 0) return "";

  const blocks = docs.map((doc, i) => {
    const raw = doc.content.replace(/\s+/g, " ").trim();
    const body =
      raw.length > MAX_ATTACHMENT_PROMPT_CHARS
        ? `${raw.slice(0, MAX_ATTACHMENT_PROMPT_CHARS)}\n…[truncated for this chat — full text is in Knowledge]`
        : raw;
    const label = `current attachment: ${doc.name || doc.id}`;
    return fenceRetrievedChunk(i + 1, label, body || "(no extractable text)");
  });

  return (
    `\n\nCurrent chat attachments (primary source for this turn — cite as [n] when you use them):` +
    untrustedEvidenceRules() +
    `\n\n` +
    blocks.join("\n\n") +
    `\n\nAttachment rules:\n` +
    `- You received these files this turn. Say so, by filename, and answer from this text.\n` +
    `- Sensitive values may already appear as [category redacted]. Skip those fields and summarize the rest. ` +
    `Do not guess the redacted values. Never say you cannot view or access the file.\n` +
    `- If a block is empty or unreadable, say so in one short clause only when they asked about that file, then answer the rest of their message. Do not ask if they are testing.`
  );
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
  return (
    `\n\nNo document excerpts were included for this turn.\n` +
    `Answer the person directly. Use general knowledge when it helps.\n` +
    `Do not say that Knowledge, a search, or the workspace failed to find something.\n` +
    `Do not invent that a file or document stated a fact you were not given.\n` +
    `Never say you cannot view attachments due to privacy or security.\n` +
    `Do not cite material you were not given.`
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
