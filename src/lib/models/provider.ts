/**
 * Unified streaming entry point for chat providers.
 *
 * Call sites (chat route) should use this instead of branching on Groq/Ollama/
 * Bedrock directly. Routing still picks the model via router.ts; this module
 * only executes the chosen provider.
 */

import { streamGroqChat, isGroqAvailable, type GroqUsage } from "./groq";
import { streamOllamaChat, checkOllamaModel } from "./ollama";
import { streamBedrockChat, isBedrockConfigured } from "./bedrock";
import { ollamaFallbackForMode } from "./router";
import type { ChatMessage, ModelProvider } from "./types";

export type StreamChatOpts = {
  messages: ChatMessage[];
  model: string;
  provider: ModelProvider;
  /** Complexity tier — used only for Ollama fallback model selection. */
  tier?: string;
  onUsage?: (usage: GroqUsage) => void;
};

/**
 * Stream assistant tokens from the requested provider, with pragmatic fallbacks:
 *   bedrock → groq → ollama
 *   groq    → ollama
 *   ollama  → (error if model missing)
 */
export async function* streamChat(opts: StreamChatOpts): AsyncGenerator<string> {
  const { messages, model, onUsage, tier = "Standard" } = opts;
  let provider = opts.provider;

  // Env override for portfolio demos: force Bedrock when explicitly requested.
  if (process.env.MODEL_PROVIDER === "bedrock" && isBedrockConfigured()) {
    provider = "bedrock";
  }

  if (provider === "bedrock") {
    if (!isBedrockConfigured()) {
      console.warn("[provider] Bedrock requested but not configured — falling back.");
      provider = isGroqAvailable() ? "groq" : "ollama";
    } else {
      try {
        for await (const delta of streamBedrockChat(messages, model)) {
          yield delta;
        }
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[provider] Bedrock failed (${msg.slice(0, 80)}). Falling back.`);
        provider = isGroqAvailable() ? "groq" : "ollama";
      }
    }
  }

  if (provider === "groq" && isGroqAvailable()) {
    try {
      for await (const delta of streamGroqChat(messages, model, onUsage)) {
        yield delta;
      }
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[provider] Groq failed (${msg.slice(0, 80)}). Falling back to Ollama.`);
    }
  }

  const fallbackModel =
    provider === "ollama" ? model : ollamaFallbackForMode(tier);
  const check = await checkOllamaModel(fallbackModel);
  if (check) {
    throw new Error(
      "No chat provider available. Set GROQ_API_KEY, configure Bedrock, or start Ollama.",
    );
  }
  for await (const delta of streamOllamaChat(messages, fallbackModel)) {
    yield delta;
  }
}
