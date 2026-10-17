/**
 * Anthropic Messages API provider.
 */

import type { ChatMessage } from "./types";
import { resolveVendorApiKey } from "./vendor-secrets";
import {
  createAnthropicUsageTracker,
  fetchWithTimeout,
  type VendorUsageCallback,
} from "./vendor-stream";
import type { CatalogModel } from "./catalog";

function splitAnthropicMessages(messages: ChatMessage[]): {
  system: string | undefined;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
} {
  const systemParts: string[] = [];
  const out: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const m of messages) {
    const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
    if (m.role === "system") {
      systemParts.push(text);
      continue;
    }
    out.push({ role: m.role, content: text });
  }
  return {
    system: systemParts.length ? systemParts.join("\n\n") : undefined,
    messages: out,
  };
}

export async function hasAnthropicRuntime(): Promise<boolean> {
  return Boolean(await resolveVendorApiKey("anthropic"));
}

export async function listAnthropicModels(apiKey: string): Promise<CatalogModel[]> {
  const res = await fetchWithTimeout("https://api.anthropic.com/v1/models", {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
  }, 15_000);
  if (!res.ok) {
    throw new Error(`Anthropic models list failed (${res.status})`);
  }
  const body = (await res.json()) as { data?: Array<{ id: string; display_name?: string }> };
  return (body.data ?? [])
    .map(m => ({
      id: m.id,
      name: m.display_name ?? m.id,
      provider: "anthropic" as const,
      modality: "text" as const,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export async function* streamAnthropicChat(
  messages: ChatMessage[],
  model: string,
  signal?: AbortSignal,
  onUsage?: VendorUsageCallback,
): AsyncGenerator<string> {
  const apiKey = await resolveVendorApiKey("anthropic");
  if (!apiKey) {
    throw new Error("Anthropic API key is not configured. Add one in Settings → Models.");
  }

  const { system, messages: turns } = splitAnthropicMessages(messages);
  const res = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
    signal,
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      stream: true,
      ...(system ? { system } : {}),
      messages: turns,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Anthropic chat failed (${res.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }
  if (!res.body) throw new Error("Anthropic returned an empty stream.");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const usageTracker = createAnthropicUsageTracker();
  let buffer = "";

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
            type?: string;
            delta?: { type?: string; text?: string };
          };
          const usage = usageTracker.push(json);
          if (usage) onUsage?.(usage);
          if (json.type === "content_block_delta" && json.delta?.text) {
            yield json.delta.text;
          }
        } catch {
          /* ignore */
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
