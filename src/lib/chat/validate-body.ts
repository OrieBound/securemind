/**
 * Shape and size checks for a chat request, before anything else reads it.
 *
 * The browser always sends a well-formed body, but anyone signed in can post their own. Without
 * these checks a wrong type crashed the turn (a 500 and an alarm), a huge summary or fact list
 * went straight into the prompt and was billed, and a history entry could claim the "system" role.
 *
 * Only the message itself is refused when too long, so a person never loses part of what they
 * asked without being told. Everything else is trimmed quietly: the limits sit well above what
 * the browser sends (40 history items, a short summary, a handful of facts), and the server
 * already cuts history to its working-memory budget later.
 */

import type { ChatRequestBody, HistoryMessage } from "@/lib/chat/types";
import { MAX_ATTACHMENT_PROMPT_CHARS, MAX_ATTACHMENTS_PER_TURN } from "@/lib/documents/constants";

/** About 25,000 tokens: a long pasted document still fits; a multi-megabyte body does not. */
export const MAX_CHAT_MESSAGE_CHARS = 100_000;
export const MAX_HISTORY_ITEMS = 60;
export const MAX_HISTORY_ITEM_CHARS = 50_000;
export const MAX_SESSION_SUMMARY_CHARS = 8_000;
export const MAX_FACTS = 100;
const MAX_FACT_KEY_CHARS = 200;
const MAX_FACT_VALUE_CHARS = 2_000;
const MAX_ID_CHARS = 200;
const MAX_NAME_CHARS = 300;

export type ChatBodyCheck =
  | { ok: true; body: ChatRequestBody }
  | { ok: false; status: number; error: string };

const str = (v: unknown, max: number): string | undefined =>
  typeof v === "string" ? v.slice(0, max) : undefined;

export function checkChatRequestBody(raw: unknown): ChatBodyCheck {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, status: 400, error: "Invalid request body" };
  }
  const b = raw as Record<string, unknown>;

  if (b.message != null && typeof b.message !== "string") {
    return { ok: false, status: 400, error: "message must be text" };
  }
  const message = (b.message as string | undefined) ?? "";
  if (message.length > MAX_CHAT_MESSAGE_CHARS) {
    return {
      ok: false,
      status: 413,
      error: `This message is too long (over ${MAX_CHAT_MESSAGE_CHARS.toLocaleString("en-US")} characters). Attach it as a file instead.`,
    };
  }

  // Only the two roles a person and the assistant can have. A "system" entry is dropped.
  const history: HistoryMessage[] = Array.isArray(b.history)
    ? b.history
        .filter((h): h is { role: "user" | "assistant"; content: string } =>
          !!h && typeof h === "object" &&
          ((h as HistoryMessage).role === "user" || (h as HistoryMessage).role === "assistant") &&
          typeof (h as HistoryMessage).content === "string")
        .slice(-MAX_HISTORY_ITEMS)
        .map(h => ({ role: h.role, content: h.content.slice(0, MAX_HISTORY_ITEM_CHARS) }))
    : [];

  const facts: Record<string, string> = {};
  if (b.facts && typeof b.facts === "object" && !Array.isArray(b.facts)) {
    for (const [k, v] of Object.entries(b.facts as Record<string, unknown>).slice(0, MAX_FACTS)) {
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        facts[k.slice(0, MAX_FACT_KEY_CHARS)] = String(v).slice(0, MAX_FACT_VALUE_CHARS);
      }
    }
  }

  const modelOverrides: Record<string, string> = {};
  if (b.modelOverrides && typeof b.modelOverrides === "object" && !Array.isArray(b.modelOverrides)) {
    for (const [tier, id] of Object.entries(b.modelOverrides as Record<string, unknown>).slice(0, 10)) {
      if (typeof id === "string" && id.length <= MAX_ID_CHARS) modelOverrides[tier.slice(0, 20)] = id;
    }
  }

  const ids = (v: unknown, max: number): string[] =>
    Array.isArray(v)
      ? v.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= MAX_ID_CHARS).slice(0, max)
      : [];

  const attachmentExtracts = Array.isArray(b.attachmentExtracts)
    ? b.attachmentExtracts
        .filter((a): a is Record<string, unknown> => !!a && typeof a === "object")
        .slice(0, MAX_ATTACHMENTS_PER_TURN)
        .map(a => ({
          id: str(a.id, MAX_ID_CHARS) ?? "",
          name: str(a.name, MAX_NAME_CHARS) ?? "",
          content: str(a.content, MAX_ATTACHMENT_PROMPT_CHARS) ?? "",
        }))
    : [];

  return {
    ok: true,
    body: {
      message,
      mode: str(b.mode, 20),
      workspaceId: str(b.workspaceId, MAX_ID_CHARS),
      images: [],
      attachmentDocumentIds: ids(b.attachmentDocumentIds, MAX_ATTACHMENTS_PER_TURN),
      attachmentExtracts,
      sessionId: str(b.sessionId, MAX_ID_CHARS),
      history,
      sessionSummary: str(b.sessionSummary, MAX_SESSION_SUMMARY_CHARS) ?? "",
      facts,
      modelOverrides,
      lastTier: str(b.lastTier, 20) ?? null,
      priorTurnHadCitations: b.priorTurnHadCitations === true,
      priorTurnWasGrounded: b.priorTurnWasGrounded === true,
      priorTurnHadAttachments: b.priorTurnHadAttachments === true,
    },
  };
}
