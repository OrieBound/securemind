/**
 * Cut-off replies. A reply is cut off when the model hit its output limit, or when it
 * stops inside a code block (a model that is cut mid-code rarely closes the fence).
 * Shared by the chat stream (server) and the message bubble (client).
 */

/** What Continue sends. Plain words, so the model resumes instead of starting over. */
export const CONTINUE_PROMPT =
  "Please continue from exactly where your last reply was cut off. Don't repeat anything you already wrote. " +
  "If it stopped inside a code block, start a new block with the same language and carry on from the next line.";

const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/** True when the text ends while a ``` or ~~~ code fence is still open. */
export function endsInsideCodeFence(text: string): boolean {
  let open: { char: string; length: number } | null = null;
  for (const line of text.split(/\r?\n/)) {
    const m = FENCE.exec(line);
    if (!m) continue;
    const run = m[1];
    const rest = line.slice(m[0].length);
    if (!open) {
      // An opening fence may carry an info string; a backtick fence's info string can't contain a backtick.
      if (run[0] === "`" && rest.includes("`")) continue;
      open = { char: run[0], length: run.length };
    } else if (run[0] === open.char && run.length >= open.length && rest.trim() === "") {
      open = null;
    }
  }
  return open !== null;
}
