/**
 * Lightweight token estimation — no tokenizer library needed.
 * Rule of thumb: ~4 characters per token (GPT/Llama family).
 * Used to build a working memory window that respects context limits
 * rather than blindly capping at N messages.
 */

const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Select the most recent messages that fit within a token budget.
 * Always includes the most recent messages and works backwards.
 *
 * @param messages  Full history array (oldest → newest)
 * @param budget    Max tokens for the working memory window (default 3000)
 * @returns         Slice of messages that fits within budget
 */
export function selectWorkingMemory(
  messages: { role: string; content: string }[],
  budget = 3000,
): { role: string; content: string }[] {
  let used = 0;
  const selected: { role: string; content: string }[] = [];

  // Walk backwards from newest — always prioritize recent context
  for (let i = messages.length - 1; i >= 0; i--) {
    const tokens = estimateTokens(messages[i].content);
    if (used + tokens > budget) break;
    used += tokens;
    selected.unshift(messages[i]);
  }

  return selected;
}
