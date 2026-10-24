import { MAX_REPLY_TOKENS, type StreamFinishCallback } from "./types";
/**
 * xAI Grok provider — OpenAI-compatible API at api.x.ai.
 * Display name is Grok. The provider id stays `xai` so it never collides with Groq.
 */

import type { ChatMessage } from "./types";
import { resolveVendorApiKey } from "./vendor-secrets";
import { fetchWithTimeout, parseOpenAiSseStream, type VendorUsageCallback } from "./vendor-stream";
import { isChatUsableModelId, type CatalogModel } from "./catalog-shared";

const XAI_API = "https://api.x.ai/v1";

function toXaiMessages(messages: ChatMessage[]): Array<{ role: string; content: string }> {
  return messages.map(m => ({
    role: m.role,
    content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
  }));
}

/** grok-4 → Grok 4, grok-3-mini → Grok 3 Mini */
export function grokDisplayName(id: string): string {
  const rest = id.trim().replace(/^grok-?/i, "");
  if (!rest) return "Grok";
  const words = rest.split(/[-_]/).filter(Boolean).map(part => {
    if (/^\d/.test(part)) return part;
    return part.charAt(0).toUpperCase() + part.slice(1);
  });
  return `Grok ${words.join(" ")}`;
}

export function isGrokChatModelId(id: string): boolean {
  const lower = id.trim().toLowerCase();
  if (!lower.startsWith("grok")) return false;
  if (/image|imagine|video|tts|embed|flux/.test(lower)) return false;
  return isChatUsableModelId(lower);
}

export async function hasXaiRuntime(): Promise<boolean> {
  return Boolean(await resolveVendorApiKey("xai"));
}

export async function listXaiModels(apiKey: string): Promise<CatalogModel[]> {
  const res = await fetchWithTimeout(`${XAI_API}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  }, 15_000);
  if (!res.ok) {
    throw new Error(`Grok models list failed (${res.status})`);
  }
  const body = (await res.json()) as { data?: Array<{ id?: string }> };
  const seen = new Set<string>();
  const models: CatalogModel[] = [];
  for (const row of body.data ?? []) {
    const id = row.id?.trim() ?? "";
    if (!id || seen.has(id) || !isGrokChatModelId(id)) continue;
    seen.add(id);
    const lower = id.toLowerCase();
    models.push({
      id,
      name: grokDisplayName(id),
      provider: "xai",
      modality: lower.includes("vision") ? "vision" : "text",
    });
  }
  return models.sort((a, b) => a.name.localeCompare(b.name));
}

export async function* streamXaiChat(
  messages: ChatMessage[],
  model: string,
  signal?: AbortSignal,
  onUsage?: VendorUsageCallback,
  onFinish?: StreamFinishCallback,
  /** Reply length limit. File turns pass a larger one; other turns use the default. */
  maxTokens: number = MAX_REPLY_TOKENS,
): AsyncGenerator<string> {
  const apiKey = await resolveVendorApiKey("xai");
  if (!apiKey) {
    throw new Error("Grok API key is not configured. Add one in Settings → Models.");
  }

  const res = await fetchWithTimeout(`${XAI_API}/chat/completions`, {
    signal,
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: toXaiMessages(messages),
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: maxTokens,
      temperature: 0.8,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Grok chat failed (${res.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }
  if (!res.body) throw new Error("Grok returned an empty stream.");

  yield* parseOpenAiSseStream(res.body, onUsage, onFinish);
}
