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

function textFromContent(content: string | Array<{ type: string; text?: string }>): string {
  if (typeof content === "string") return content;
  return content
    .filter((part): part is { type: "text"; text: string } => part.type === "text" && Boolean(part.text))
    .map(part => part.text)
    .join("\n");
}

/**
 * Character-based fallback when a cloud provider omits stream usage.
 * Not a tokenizer — Cost UI still labels the result as an estimate.
 */
export function estimateChatUsage(
  messages: { content: string | Array<{ type: string; text?: string }> }[],
  answer: string,
): { promptTokens: number; completionTokens: number } {
  const promptTokens = messages.reduce(
    (sum, message) => sum + estimateTokens(textFromContent(message.content)),
    0,
  );
  return {
    promptTokens,
    completionTokens: estimateTokens(answer),
  };
}

/**
 * Usage to record for a finished, failed or stopped turn. A provider that returned no
 * usage is estimated from text length, but only once some reply text was produced:
 * a call that failed before generating anything (bad key, 4xx) is not billed, while
 * a reply cut off midway was. Local Ollama is $0 and never needs an estimate.
 */
export function usageToRecord(
  reported: { promptTokens: number; completionTokens: number } | null,
  provider: string,
  messages: { content: string | Array<{ type: string; text?: string }> }[],
  partialAnswer: string,
): { promptTokens: number; completionTokens: number } | null {
  if (reported) return reported;
  if (provider.toLowerCase() === "ollama") return null;
  if (!partialAnswer.trim()) return null;
  return estimateChatUsage(messages, partialAnswer);
}

/**
 * Select the most recent messages that fit within a token budget.
 * Attachment extracts are pinned first so a long first reply cannot drop the file
 * on the next turn (the live message has the extract; history otherwise would not).
 */
export function selectWorkingMemory(
  messages: { role: string; content: string }[],
  budget = 3000,
): { role: string; content: string }[] {
  if (messages.length === 0 || budget <= 0) return [];

  const isPinned = (m: { role: string; content: string }) =>
    m.role === "user" && m.content.includes("[Attached document:");

  const contents = messages.map(m => m.content);
  const included = new Array(messages.length).fill(false);
  let used = 0;

  const pinBudget = Math.max(Math.floor(budget * 0.7), budget - 800);
  const pinnedNewestFirst: number[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isPinned(messages[i])) pinnedNewestFirst.push(i);
  }
  for (const i of pinnedNewestFirst.slice(0, 2)) {
    const remaining = pinBudget - used;
    if (remaining < 80) break;
    const clipped = truncateToTokens(contents[i], remaining);
    const tokens = estimateTokens(clipped);
    if (tokens > remaining) break;
    contents[i] = clipped;
    used += tokens;
    included[i] = true;
  }

  for (let i = messages.length - 1; i >= 0; i--) {
    if (included[i]) continue;
    const tokens = estimateTokens(contents[i]);
    if (used + tokens > budget) continue;
    used += tokens;
    included[i] = true;
  }

  return messages.flatMap((m, i) =>
    included[i] ? [{ role: m.role, content: contents[i] }] : [],
  );
}

function truncateToTokens(text: string, maxTokens: number): string {
  if (estimateTokens(text) <= maxTokens) return text;
  const suffix = "\n…[truncated to fit this turn]";
  const maxChars = Math.max(0, maxTokens * CHARS_PER_TOKEN - suffix.length);
  return `${text.slice(0, maxChars)}${suffix}`;
}
