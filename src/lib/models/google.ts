/**
 * Google Gemini provider (Google AI Studio / Generative Language API).
 */

import type { ChatMessage } from "./types";
import { resolveVendorApiKey } from "./vendor-secrets";
import { fetchWithTimeout } from "./vendor-stream";
import { isChatUsableModelId, type CatalogModel } from "./catalog-shared";

function toGeminiContents(messages: ChatMessage[]): Array<{
  role: "user" | "model";
  parts: Array<{ text: string }>;
}> {
  const out: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> = [];
  let systemPrefix = "";

  for (const m of messages) {
    const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
    if (m.role === "system") {
      systemPrefix += (systemPrefix ? "\n\n" : "") + text;
      continue;
    }
    const role = m.role === "assistant" ? "model" : "user";
    const body = systemPrefix && role === "user" && out.length === 0 ? `${systemPrefix}\n\n${text}` : text;
    if (systemPrefix && role === "user" && out.length === 0) systemPrefix = "";
    out.push({ role, parts: [{ text: body }] });
  }

  if (systemPrefix && out.length === 0) {
    out.push({ role: "user", parts: [{ text: systemPrefix }] });
  }

  return out;
}

export async function hasGoogleRuntime(): Promise<boolean> {
  return Boolean(await resolveVendorApiKey("google"));
}

export async function listGoogleModels(apiKey: string): Promise<CatalogModel[]> {
  const url = new URL("https://generativelanguage.googleapis.com/v1beta/models");
  url.searchParams.set("key", apiKey);
  const res = await fetchWithTimeout(url.toString(), {}, 15_000);
  if (!res.ok) {
    throw new Error(`Google models list failed (${res.status})`);
  }
  const body = (await res.json()) as {
    models?: Array<{ name?: string; displayName?: string; supportedGenerationMethods?: string[] }>;
  };
  return (body.models ?? [])
    .filter(m => (m.supportedGenerationMethods ?? []).includes("generateContent"))
    .map(m => {
      const id = (m.name ?? "").replace(/^models\//, "");
      return {
        id,
        name: m.displayName ?? id,
        provider: "google" as const,
        modality: "text" as const,
      };
    })
    .filter(m => m.id && isChatUsableModelId(m.id))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function* streamGoogleChat(
  messages: ChatMessage[],
  model: string,
): AsyncGenerator<string> {
  const apiKey = await resolveVendorApiKey("google");
  if (!apiKey) {
    throw new Error("Google API key is not configured. Add one in Settings → Providers.");
  }

  const modelId = model.startsWith("models/") ? model.slice("models/".length) : model;
  const url = new URL(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:streamGenerateContent`,
  );
  url.searchParams.set("alt", "sse");
  url.searchParams.set("key", apiKey);

  const res = await fetchWithTimeout(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: toGeminiContents(messages) }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Google Gemini chat failed (${res.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }
  if (!res.body) throw new Error("Google returned an empty stream.");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
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
        if (!payload) continue;
        try {
          const json = JSON.parse(payload) as {
            candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
          };
          const parts = json.candidates?.[0]?.content?.parts ?? [];
          for (const p of parts) {
            if (p.text) yield p.text;
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
