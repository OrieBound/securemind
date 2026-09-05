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

/** Keep filename labels, drop stored extracts so a new attach is not drowned by the previous file. */
export function compactAttachedDocumentHistory(content: string): string {
  const names = attachedDocumentNamesFromText(content);
  if (names.length === 0) return content;
  const visible = stripAttachedDocumentBlock(content);
  const labels = names.map(n => `[Attached document: ${n}]`).join("\n");
  return visible ? `${visible}\n\n${labels}` : labels;
}

/**
 * Merge server-persisted docs with same-turn extracts from the browser.
 * Persisted text wins when present; the client extract fills a lookup miss
 * or an ingest that has not finished writing yet.
 */
export function mergeCurrentAttachments(opts: {
  ids: string[];
  persisted: CurrentAttachmentDoc[];
  clientExtracts: unknown;
}): CurrentAttachmentDoc[] {
  const allowed = new Set(opts.ids);
  const byId = new Map<string, CurrentAttachmentDoc>();
  for (const doc of opts.persisted) {
    if (!allowed.has(doc.id)) continue;
    byId.set(doc.id, {
      id: doc.id,
      name: doc.name,
      content: doc.content.slice(0, MAX_ATTACHMENT_PROMPT_CHARS),
    });
  }
  if (Array.isArray(opts.clientExtracts)) {
    for (const raw of opts.clientExtracts) {
      if (!raw || typeof raw !== "object") continue;
      const rec = raw as Record<string, unknown>;
      const id = typeof rec.id === "string" ? rec.id : "";
      if (!allowed.has(id)) continue;
      const name = typeof rec.name === "string" && rec.name.trim() ? rec.name.trim() : id;
      const content = typeof rec.content === "string"
        ? rec.content.slice(0, MAX_ATTACHMENT_PROMPT_CHARS)
        : "";
      const existing = byId.get(id);
      if (!existing) {
        byId.set(id, { id, name, content });
      } else if (!existing.content.trim() && content) {
        byId.set(id, { ...existing, content });
      }
    }
  }
  return opts.ids
    .map(id => byId.get(id))
    .filter((d): d is CurrentAttachmentDoc => Boolean(d));
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
