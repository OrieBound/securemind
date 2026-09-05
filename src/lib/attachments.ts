/**
 * Client-safe helpers for chat attachment text (no DB / Node-only imports).
 */

import {
  MAX_ATTACHMENT_PROMPT_CHARS,
  MAX_ATTACHMENTS_PER_TURN,
} from "@/lib/documents/constants";

export {
  MAX_ATTACHMENT_PROMPT_CHARS,
  MAX_ATTACHMENTS_PER_TURN,
  ATTACHMENT_LIMITS_HINT,
  MAX_FILE_MB,
  MAX_FILE_BYTES,
} from "@/lib/documents/constants";

export type CurrentAttachmentDoc = {
  id: string;
  name: string;
  content: string;
};

/** Labels stored in user-message history (hidden in the visible bubble). */
const ATTACHED_DOCUMENT_LABEL_RE = /\[Attached document: ([^\]]+)\]/g;

/** Filenames from `[Attached document: name]` history blocks. */
export function attachedDocumentNamesFromText(text: string): string[] {
  const names: string[] = [];
  const re = new RegExp(ATTACHED_DOCUMENT_LABEL_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const name = m[1]?.trim();
    if (name) names.push(name);
  }
  return names;
}

/** Hide history-only attachment payloads from the visible user bubble. */
export function stripAttachedDocumentBlock(content: string): string {
  const idx = content.search(/(?:^|\n\n)\[Attached document:/);
  if (idx === -1) return content;
  return content.slice(0, idx).trim();
}

/** Append filenames to a retrieval query so follow-ups can rank the right chunks. */
export function withAttachmentNamesInQuery(query: string, names: string[]): string {
  const unique = [...new Set(names.map(n => n.trim()).filter(Boolean))];
  if (unique.length === 0) return query;
  const extra = unique.filter(n => !query.toLowerCase().includes(n.toLowerCase()));
  if (extra.length === 0) return query;
  return `${query}\n${extra.join(" ")}`;
}

/** Compact block for conversation history so follow-up turns still see the file. */
export function formatAttachmentsForHistory(docs: CurrentAttachmentDoc[]): string {
  if (docs.length === 0) return "";
  return docs
    .slice(0, MAX_ATTACHMENTS_PER_TURN)
    .map(doc => {
      const raw = doc.content.trim();
      const body =
        raw.length > MAX_ATTACHMENT_PROMPT_CHARS
          ? `${raw.slice(0, MAX_ATTACHMENT_PROMPT_CHARS)}\n…[truncated for this chat — full text is in Knowledge]`
          : raw;
      return `[Attached document: ${doc.name}]\n${body || "(no extractable text)"}`;
    })
    .join("\n\n");
}
