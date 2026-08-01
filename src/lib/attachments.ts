/**
 * Client-safe helpers for chat attachment text (no DB / Node-only imports).
 */

/** Cap per-attachment text injected into the chat prompt / history. */
export const MAX_ATTACHMENT_PROMPT_CHARS = 24_000;

export type CurrentAttachmentDoc = {
  id: string;
  name: string;
  content: string;
};

/** Compact block for conversation history so follow-up turns still see the file. */
export function formatAttachmentsForHistory(docs: CurrentAttachmentDoc[]): string {
  if (docs.length === 0) return "";
  return docs
    .map(doc => {
      const raw = doc.content.trim();
      const body =
        raw.length > MAX_ATTACHMENT_PROMPT_CHARS
          ? `${raw.slice(0, MAX_ATTACHMENT_PROMPT_CHARS)}\n…[truncated]`
          : raw;
      return `[Attached document: ${doc.name}]\n${body || "(no extractable text)"}`;
    })
    .join("\n\n");
}
