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

import type { ChatMessage } from "./types";

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";

type OllamaChatLine = {
  model: string;
  message?: { role: string; content: string };
  done: boolean;
  error?: string;
};

/**
 * Streams assistant content tokens from Ollama's native /api/chat endpoint.
 * Yields each text delta as it arrives — same interface regardless of model.
 */
export async function* streamOllamaChat(
  messages: ChatMessage[],
  model: string,
): AsyncGenerator<string> {
  let resp: Response;

  try {
    resp = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, stream: true }),
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

      if (parsed.done) return;
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
      body: JSON.stringify({ model, prompt: text }),
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
