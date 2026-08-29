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
