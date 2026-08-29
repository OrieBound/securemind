/**
 * OpenAI chat provider — direct API key (not Azure).
 */

import type { ChatMessage } from "./types";
import { resolveVendorApiKey } from "./vendor-secrets";
import { fetchWithTimeout, parseOpenAiSseStream } from "./vendor-stream";
import { isChatUsableModelId, type CatalogModel } from "./catalog-shared";

function toOpenAiMessages(messages: ChatMessage[]): Array<{ role: string; content: string }> {
  return messages.map(m => ({
    role: m.role,
    content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
  }));
}

export async function hasOpenAIRuntime(): Promise<boolean> {
  return Boolean(await resolveVendorApiKey("openai"));
}

export async function listOpenAIModels(apiKey: string): Promise<CatalogModel[]> {
  const res = await fetchWithTimeout("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
  }, 15_000);
  if (!res.ok) {
    throw new Error(`OpenAI models list failed (${res.status})`);
  }
  const body = (await res.json()) as { data?: Array<{ id: string }> };
  const chatPrefixes = ["gpt-", "o1", "o3", "o4", "chatgpt-"];
  return (body.data ?? [])
    .filter(m => chatPrefixes.some(p => m.id.startsWith(p)))
    .filter(m => !m.id.includes("instruct") && !m.id.includes("realtime") && !m.id.includes("audio"))
    .filter(m => isChatUsableModelId(m.id))
    .map(m => ({
      id: m.id,
      name: m.id,
      provider: "openai" as const,
      modality: "text" as const,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export async function* streamOpenAIChat(
  messages: ChatMessage[],
  model: string,
): AsyncGenerator<string> {
  const apiKey = await resolveVendorApiKey("openai");
  if (!apiKey) {
    throw new Error("OpenAI API key is not configured. Add one in Settings → Providers.");
  }

  const res = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: toOpenAiMessages(messages),
      stream: true,
      max_tokens: 1024,
      temperature: 0.8,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`OpenAI chat failed (${res.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }
  if (!res.body) throw new Error("OpenAI returned an empty stream.");

  yield* parseOpenAiSseStream(res.body);
}
