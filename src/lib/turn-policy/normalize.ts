/**
 * Strip optional conversational prefixes so "Hello, what caused the outage?"
 * is classified on the substantive remainder — not message length alone.
 */

const PREFIX_RE =
  /^(?:(?:hello|hi|hey|howdy|yo|excuse\s+me|quick\s+question|one\s+question|thanks|thank\s+you|thx|good\s+(?:morning|afternoon|evening))(?:\s+there)?(?:\s+(?:sir|ma'?am|team|everyone|folks))?)\s*[,!.:—–-]*\s*/i;

/** Repeatedly peel conversational openers. */
export function stripConversationalPrefixes(message: string): {
  remainder: string;
  strippedPrefix: boolean;
} {
  let remainder = message.trim().replace(/\s+/g, " ");
  let strippedPrefix = false;
  for (let i = 0; i < 3; i++) {
    const next = remainder.replace(PREFIX_RE, "").trim();
    if (next === remainder) break;
    remainder = next;
    strippedPrefix = true;
  }
  return { remainder, strippedPrefix };
}

export function normalizeMessage(message: string): string {
  return message.trim().replace(/\s+/g, " ");
}
