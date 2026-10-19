/**
 * Server-side gate for chat requests (defense in depth).
 *
 * Detection normally runs in the browser before anything is sent. A crafted request can skip
 * the browser, so the server re-checks every text field of the chat body for the categories
 * that can never be safe-listed (SSN, SIN, card number, secrets) and replaces any match with the
 * same placeholder the browser uses. Other categories stay a browser-side decision, because the
 * person may have reviewed and kept them on purpose. Values are never logged; only counts.
 */

import { NON_EXEMPTIBLE_CATEGORIES, scrubPII } from "@/lib/pii";
import type { ChatRequestBody } from "@/lib/chat/types";

function gate(text: string, counter: { n: number }): string {
  if (typeof text !== "string" || !text) return text;
  const r = scrubPII(text, { sensitivity: "high", onlyCategories: NON_EXEMPTIBLE_CATEGORIES });
  if (!r.hadRedactions) return text;
  counter.n += r.scrubEvents.reduce((sum, e) => sum + e.count, 0);
  return r.sanitized;
}

export function scrubChatRequestServerSide(body: ChatRequestBody): { body: ChatRequestBody; redactions: number } {
  const counter = { n: 0 };
  const next: ChatRequestBody = {
    ...body,
    message: gate(body.message, counter),
    sessionSummary: body.sessionSummary ? gate(body.sessionSummary, counter) : body.sessionSummary,
    history: Array.isArray(body.history)
      ? body.history.map(h => ({ ...h, content: gate(h.content, counter) }))
      : body.history,
    attachmentExtracts: Array.isArray(body.attachmentExtracts)
      ? body.attachmentExtracts.map(a => ({ ...a, content: gate(a.content, counter) }))
      : body.attachmentExtracts,
    facts:
      body.facts && typeof body.facts === "object"
        ? Object.fromEntries(Object.entries(body.facts).map(([k, v]) => [k, gate(String(v), counter)]))
        : body.facts,
  };
  return { body: next, redactions: counter.n };
}
