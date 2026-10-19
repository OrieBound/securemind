/**
 * Ollama provider — streams chat completions from a local Ollama instance.
 *
 * Setup (one-time, on your machine):
 *   1. Install Ollama: https://ollama.com/download
 *   2. Pull a chat model:   ollama pull llama3.2
 *   3. Pull a fast model:   ollama pull llama3.2:3b      (for summarize / extract)
 *   4. Pull an embed model: ollama pull nomic-embed-text  (for Phase B memory)
 *   Ollama runs automatically as a background service on port 11434.
 *
 * Environment variables (optional overrides via .env.local):
 *   OLLAMA_BASE_URL       default: http://localhost:11434
 *   OLLAMA_CHAT_MODEL     default: llama3.2
 *   OLLAMA_FAST_MODEL     default: llama3.2:3b
 *   OLLAMA_EMBED_MODEL    default: nomic-embed-text
 */

import type { ChatMessage, StreamFinishCallback } from "./types";
import { ollamaFallbackForMode } from "./router";
import { pickInstalledChatModel, probeHardware } from "./local-recommendations";

/** True when the model id is an embedding / non-chat Ollama tag. */
export function isOllamaEmbedModel(model: string): boolean {
  return /embed/i.test(model);
}

/** Map a routed cloud model id to a local Ollama tag when Ollama is the intended provider. */
export function resolveOllamaChatModel(model: string, tier: string): string {
  const chatDefault = process.env.OLLAMA_CHAT_MODEL ?? "llama3.2";
  if (isOllamaEmbedModel(model)) return chatDefault;
  if (!model || model === chatDefault) return chatDefault;
  if (
    model.includes("/") ||
    model.includes("-instant") ||
    /^amazon\./.test(model) ||
    /^anthropic\./.test(model) ||
    /^meta\./.test(model) ||
    /^us\./.test(model)
  ) {
    return ollamaFallbackForMode(tier);
  }
  return model;
}

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";

export function ollamaBaseUrl(): string {
  return OLLAMA_BASE;
}

/** Inspect installed weights without generating text or downloading a model. */
export async function ollamaModelCapabilities(model: string): Promise<string[] | null> {
  try {
    const response = await fetch(`${OLLAMA_BASE}/api/show`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) return null;
    const body = await response.json() as { capabilities?: unknown };
    return Array.isArray(body.capabilities) ? body.capabilities.filter((c): c is string => typeof c === "string") : null;
  } catch {
    return null;
  }
}

export type OllamaProbe = {
  reachable: boolean;
  tags: string[];
};

/** Tags only — short timeout. Never pulls and never lists cloud catalogs. */
export async function probeOllama(timeoutMs = 2500): Promise<OllamaProbe> {
  try {
    const resp = await fetch(`${OLLAMA_BASE}/api/tags`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!resp.ok) return { reachable: false, tags: [] };
    const body = (await resp.json()) as { models?: Array<{ name: string }> };
    return {
      reachable: true,
      tags: (body.models ?? []).map(m => m.name).filter(Boolean),
    };
  } catch {
    return { reachable: false, tags: [] };
  }
}

/**
 * Load weights into Ollama so the next chat turn is less likely to wait on a cold model.
 * Never pulls. Safe to fire-and-forget from /api/warm.
 */
export async function preloadOllamaChatModel(): Promise<void> {
  const probe = await probeOllama(2000);
  if (!probe.reachable) return;
  const model = pickInstalledChatModel(
    probe.tags.filter(t => !isOllamaEmbedModel(t)),
    probeHardware(),
  );
  if (!model) return;
  await fetch(`${OLLAMA_BASE}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt: " ",
      stream: false,
      keep_alive: "30m",
      options: { num_predict: 0, num_ctx: 512 },
    }),
    signal: AbortSignal.timeout(90_000),
  }).catch(() => { /* preload is best-effort */ });
}

type OllamaChatLine = {
  model: string;
  message?: { role: string; content: string };
  done: boolean;
  done_reason?: string;
  error?: string;
};

/**
 * Streams assistant content tokens from Ollama's native /api/chat endpoint.
 * Yields each text delta as it arrives — same interface regardless of model.
 */
export async function* streamOllamaChat(
  messages: ChatMessage[],
  model: string,
  signal?: AbortSignal,
  onFinish?: StreamFinishCallback,
): AsyncGenerator<string> {
  let resp: Response;

  try {
    resp = await fetch(`${OLLAMA_BASE}/api/chat`, {
      signal,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        keep_alive: "30m",
        options: {
          num_ctx: 4096,
          num_predict: 2048,
        },
      }),
    });
  } catch (err) {
    throw new Error(
      `Cannot reach Ollama at ${OLLAMA_BASE}. ` +
        `Make sure Ollama is installed and running (ollama serve). ` +
        `Original error: ${String(err)}`,
    );
  }

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Ollama returned ${resp.status}: ${body}`);
  }

  if (!resp.body) {
    throw new Error("Ollama response has no body.");
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let parsed: OllamaChatLine;
      try {
        parsed = JSON.parse(trimmed) as OllamaChatLine;
      } catch {
        continue;
      }

      if (parsed.error) {
        throw new Error(`Ollama model error: ${parsed.error}`);
      }

      const content = parsed.message?.content;
      if (content) {
        yield content;
      }

      if (parsed.done) {
        onFinish?.({ truncated: parsed.done_reason === "length" });
        return;
      }
    }
  }
}

/**
 * Generates a dense embedding vector for the given text using nomic-embed-text.
 * Returns a 768-dimensional float array suitable for pgvector storage.
 * Zero cost — runs entirely on the local Ollama instance.
 */
export async function embedText(text: string): Promise<number[]> {
  const model = process.env.OLLAMA_EMBED_MODEL ?? "nomic-embed-text";
  let resp: Response;
  try {
    resp = await fetch(`${OLLAMA_BASE}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Keep the embedder resident so a question never waits on a cold model load.
      body: JSON.stringify({ model, prompt: text, keep_alive: "30m" }),
    });
  } catch (err) {
    throw new Error(`Cannot reach Ollama for embeddings. Original error: ${String(err)}`);
  }
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Ollama embed returned ${resp.status}: ${body}`);
  }
  const data = await resp.json() as { embedding: number[] };
  if (!Array.isArray(data.embedding) || data.embedding.length === 0) {
    throw new Error("Ollama embed returned an empty or malformed vector.");
  }
  return data.embedding;
}

/**
 * Check whether Ollama is reachable and the requested model is available.
 * Returns null on success or an error string.
 */
export async function checkOllamaModel(model: string): Promise<string | null> {
  try {
    const resp = await fetch(`${OLLAMA_BASE}/api/show`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: model }),
    });
    if (!resp.ok) {
      return `Model "${model}" not found locally. Run: ollama pull ${model}`;
    }
    return null;
  } catch {
    return `Ollama is not running. Install from https://ollama.com/download then run: ollama serve`;
  }
}
