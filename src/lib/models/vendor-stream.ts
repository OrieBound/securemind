import type { StreamFinishCallback } from "./types";
/**
 * Parse OpenAI-compatible SSE streams (OpenAI, Groq-style deltas).
 */

export type VendorUsage = { promptTokens: number; completionTokens: number };
export type VendorUsageCallback = (usage: VendorUsage) => void;

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/** OpenAI-compatible `usage` object, sent on the last chunk when include_usage is set. */
export function usageFromOpenAiChunk(json: unknown): VendorUsage | null {
  const u = (json as { usage?: Record<string, unknown> | null } | null)?.usage;
  if (!u) return null;
  const promptTokens = count(u.prompt_tokens);
  const completionTokens = count(u.completion_tokens);
  if (promptTokens == null || completionTokens == null) return null;
  return { promptTokens, completionTokens };
}

/**
 * Anthropic reports input tokens on `message_start` and the running output total on
 * `message_delta`. Push each event; a non-null return is the latest totals.
 */
export function createAnthropicUsageTracker() {
  let promptTokens: number | null = null;
  let completionTokens: number | null = null;
  return {
    push(event: unknown): VendorUsage | null {
      const e = event as {
        type?: string;
        message?: { usage?: Record<string, unknown> };
        usage?: Record<string, unknown>;
      };
      if (e?.type === "message_start") {
        const u = e.message?.usage;
        // Cache reads/writes are billed as input too; count them so the estimate runs high.
        const input = count(u?.input_tokens);
        if (input != null) {
          promptTokens =
            input +
            (count(u?.cache_creation_input_tokens) ?? 0) +
            (count(u?.cache_read_input_tokens) ?? 0);
        }
        completionTokens = count(u?.output_tokens) ?? completionTokens;
      } else if (e?.type === "message_delta") {
        completionTokens = count(e.usage?.output_tokens) ?? completionTokens;
      } else {
        return null;
      }
      if (promptTokens == null || completionTokens == null) return null;
      return { promptTokens, completionTokens };
    },
  };
}

/** Gemini `usageMetadata`; thinking tokens are billed as output. */
export function usageFromGeminiChunk(json: unknown): VendorUsage | null {
  const m = (json as { usageMetadata?: Record<string, unknown> } | null)?.usageMetadata;
  if (!m) return null;
  const promptTokens = count(m.promptTokenCount);
  const candidates = count(m.candidatesTokenCount);
  if (promptTokens == null || candidates == null) return null;
  return { promptTokens, completionTokens: candidates + (count(m.thoughtsTokenCount) ?? 0) };
}

export async function* parseOpenAiSseStream(
  body: ReadableStream<Uint8Array>,
  onUsage?: VendorUsageCallback,
  onFinish?: StreamFinishCallback,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let truncated = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const json = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string | null }; finish_reason?: string | null }>;
            usage?: Record<string, unknown> | null;
          };
          if (json.choices?.[0]?.finish_reason === "length") truncated = true;
          const usage = onUsage ? usageFromOpenAiChunk(json) : null;
          if (usage) onUsage?.(usage);
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) yield delta;
        } catch {
          /* ignore malformed chunks */
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  onFinish?.({ truncated });
}

export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = 60_000,
): Promise<Response> {
  const timeout = AbortSignal.timeout(timeoutMs);
  return fetch(url, { ...init, signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
}
