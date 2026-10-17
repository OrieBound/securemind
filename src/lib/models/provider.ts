/**
 * Unified streaming entry point for chat providers.
 *
 * Call sites (chat route) should use this instead of branching on Groq/Ollama/
 * Bedrock directly. Routing still picks the model via router.ts; this module
 * only executes the chosen provider.
 */

import {
  streamGroqChat,
  hasGroqRuntime,
  getGroqUnavailableReason,
  GROQ_NOT_CONFIGURED_MESSAGE,
  VENDOR_RISK_REQUIRED_CODE,
  VENDOR_RISK_REQUIRED_MESSAGE,
  type GroqUsage,
} from "./groq";
import { formatGroqChatError } from "./groq-connectivity";
import { streamOllamaChat, checkOllamaModel, resolveOllamaChatModel } from "./ollama";
import { streamBedrockChat, isBedrockConfigured, bedrockBlockReason } from "./bedrock";
import { streamOpenAIChat, hasOpenAIRuntime } from "./openai";
import { streamAnthropicChat, hasAnthropicRuntime } from "./anthropic";
import { streamGoogleChat, hasGoogleRuntime } from "./google";
import { streamXaiChat, hasXaiRuntime } from "./xai";
import { ollamaFallbackForMode } from "./router";
import { resolveRuntimeSecrets } from "@/lib/instance-config";
import type { ChatMessage, ModelProvider } from "./types";

export type StreamChatOpts = {
  messages: ChatMessage[];
  model: string;
  provider: ModelProvider;
  /** Complexity tier — used only for Ollama fallback model selection. */
  tier?: string;
  onUsage?: (usage: GroqUsage) => void;
  /** Fired when the live provider/model is known (including Groq → Ollama fallback). */
  onResolved?: (info: { provider: ModelProvider; model: string }) => void;
  /**
   * User picked this model (tier override or fixed-model mode).
   * Do not remap to the instance primary, and do not silently fall back to Ollama.
   */
  lockProvider?: boolean;
};

/**
 * Stream assistant tokens from the requested provider.
 * A failed Groq call is reported to the user on every edition. It is not replaced
 * with Ollama. Ollama runs only when it is the selected provider.
 */
export async function* streamChat(opts: StreamChatOpts): AsyncGenerator<string> {
  const { messages, model, onUsage, tier = "Standard" } = opts;
  let provider = opts.provider;
  const lockProvider = Boolean(opts.lockProvider);

  const secrets = await resolveRuntimeSecrets();
  const bedrockOk = await isBedrockConfigured();
  const groqOk = await hasGroqRuntime();

  // Instance Settings / env can force a primary — unless the user picked a model.
  if (!lockProvider) {
    if (
      (secrets.primaryProvider === "bedrock" || process.env.MODEL_PROVIDER === "bedrock") &&
      bedrockOk
    ) {
      provider = "bedrock";
    } else if (secrets.primaryProvider === "ollama") {
      provider = "ollama";
    } else if (secrets.primaryProvider === "groq" && groqOk) {
      provider = "groq";
    }
  }

  const ollamaPrimary =
    !lockProvider && (secrets.primaryProvider === "ollama" || opts.provider === "ollama");

  if (provider === "bedrock") {
    if (!bedrockOk) {
      if (ollamaPrimary) {
        console.warn("[provider] Bedrock requested but not configured — falling back to Ollama.");
        provider = "ollama";
      } else if (groqOk) {
        console.warn("[provider] Bedrock requested but not configured — falling back to Groq.");
        provider = "groq";
      } else {
        throw new Error(await bedrockBlockReason() ?? "Bedrock is not configured.");
      }
    } else {
      try {
        // An explicitly chosen Bedrock model wins. `bedrockChatModel` is only
        // the default for traffic routed here by primaryProvider, where `model`
        // is a Groq id that Bedrock would reject.
        const bedrockModel =
          opts.provider === "bedrock" ? model : secrets.bedrockChatModel || model;
        opts.onResolved?.({ provider: "bedrock", model: bedrockModel });
        for await (const delta of streamBedrockChat(messages, bedrockModel, onUsage)) {
          yield delta;
        }
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (lockProvider) {
          throw err instanceof Error ? err : new Error(msg);
        }
        if (ollamaPrimary) {
          console.warn(`[provider] Bedrock failed (${msg.slice(0, 80)}). Falling back to Ollama.`);
          provider = "ollama";
        } else if (groqOk) {
          console.warn(`[provider] Bedrock failed (${msg.slice(0, 80)}). Falling back to Groq.`);
          provider = "groq";
        } else {
          throw err instanceof Error ? err : new Error(msg);
        }
      }
    }
  }

  if (provider === "groq") {
    if (!groqOk) {
      const groqBlock = await getGroqUnavailableReason();
      if (groqBlock === "vendor_risk_required") {
        throw new Error(`${VENDOR_RISK_REQUIRED_CODE}:${VENDOR_RISK_REQUIRED_MESSAGE}`);
      }
      throw new Error(GROQ_NOT_CONFIGURED_MESSAGE);
    }
    try {
      opts.onResolved?.({ provider: "groq", model });
      for await (const delta of streamGroqChat(messages, model, onUsage)) {
        yield delta;
      }
      return;
    } catch (err) {
      throw new Error(formatGroqChatError(err));
    }
  }

  if (provider === "openai") {
    if (!(await hasOpenAIRuntime())) {
      throw new Error("OpenAI is not configured. Add an API key in Settings → Models.");
    }
    for await (const delta of streamOpenAIChat(messages, model, undefined, onUsage)) {
      yield delta;
    }
    return;
  }

  if (provider === "anthropic") {
    if (!(await hasAnthropicRuntime())) {
      throw new Error("Anthropic is not configured. Add an API key in Settings → Models.");
    }
    for await (const delta of streamAnthropicChat(messages, model, undefined, onUsage)) {
      yield delta;
    }
    return;
  }

  if (provider === "google") {
    if (!(await hasGoogleRuntime())) {
      throw new Error("Gemini is not configured. Add an API key in Settings → Models.");
    }
    for await (const delta of streamGoogleChat(messages, model, undefined, onUsage)) {
      yield delta;
    }
    return;
  }

  if (provider === "xai") {
    if (!(await hasXaiRuntime())) {
      throw new Error("Grok is not configured. Add an API key in Settings → Models.");
    }
    for await (const delta of streamXaiChat(messages, model, undefined, onUsage)) {
      yield delta;
    }
    return;
  }

  if (provider !== "ollama" && !ollamaPrimary && opts.provider !== "ollama") {
    throw new Error(GROQ_NOT_CONFIGURED_MESSAGE);
  }

  const fallbackModel = resolveOllamaChatModel(
    provider === "ollama" ? model : ollamaFallbackForMode(tier),
    tier,
  );
  const check = await checkOllamaModel(fallbackModel);
  if (check) {
    throw new Error(check);
  }
  opts.onResolved?.({ provider: "ollama", model: fallbackModel });
  for await (const delta of streamOllamaChat(messages, fallbackModel)) {
    yield delta;
  }
}
