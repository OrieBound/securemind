/**
 * Smallest possible chat call that proves a listed model can actually answer.
 * Shared by the single Test button and the one-time setup sweep.
 */

import { resolveAllowedModel } from "@/lib/models/allowlist";
import { streamBedrockChat } from "@/lib/models/bedrock";
import { streamGroqChat } from "@/lib/models/groq";
import { streamOllamaChat } from "@/lib/models/ollama";
import { streamOpenAIChat } from "@/lib/models/openai";
import { streamAnthropicChat } from "@/lib/models/anthropic";
import { streamGoogleChat } from "@/lib/models/google";
import { streamXaiChat } from "@/lib/models/xai";
import type { ChatMessage, ModelProvider } from "@/lib/models/types";
import { diagnoseModelTestError } from "@/lib/models/test-diagnose";
import { modelCredentialScope, patchModelAvailability } from "@/lib/models/model-availability-store";
import { invalidateModelCatalogCache } from "@/lib/models/catalog";
import { isAccountWideSetupStop } from "@/lib/models/setup-check";

const MAX_SAMPLE_CHARS = 80;
const TIMEOUT_MS = 30_000;

export type ReachabilityResult = {
  ok: boolean;
  modelId: string;
  provider?: ModelProvider;
  latencyMs?: number;
  sample?: string;
  code?: string;
  message?: string;
  remediation?: string | null;
};

function streamExactly(
  provider: ModelProvider,
  model: string,
  messages: ChatMessage[],
  signal: AbortSignal,
): AsyncGenerator<string> {
  if (provider === "bedrock") return streamBedrockChat(messages, model, undefined, signal);
  if (provider === "ollama") return streamOllamaChat(messages, model, signal);
  if (provider === "openai") return streamOpenAIChat(messages, model, signal);
  if (provider === "anthropic") return streamAnthropicChat(messages, model, signal);
  if (provider === "google") return streamGoogleChat(messages, model, signal);
  if (provider === "xai") return streamXaiChat(messages, model, signal);
  return streamGroqChat(messages, model, undefined, signal);
}

export async function checkModelReachability(opts: {
  modelId: string;
  providerHint?: string;
  signal?: AbortSignal;
  userId: string;
  /**
   * Test button stores every result. The setup sweep skips account-wide
   * failures so a later check can retry after credits or connectivity return.
   */
  persistAccountWide?: boolean;
  /** Setup sweep leaves the catalog cache alone and refreshes once at the end. */
  touchCatalogCache?: boolean;
}): Promise<ReachabilityResult> {
  const allowed = await resolveAllowedModel(opts.modelId, {
    forTest: true,
    provider: opts.providerHint,
  });
  if (!allowed) {
    return {
      ok: false,
      modelId: opts.modelId,
      code: "not_allowlisted",
      message: "This model is not in the server-side allowlist.",
      remediation: "Refresh the catalog, or check that its provider is still configured.",
    };
  }

  const started = Date.now();
  const scope = await modelCredentialScope(allowed.provider);
  const saveCheck = async (ok: boolean, code?: string, message?: string) => {
    const skip =
      opts.persistAccountWide === false &&
      (code === "throttled" || isAccountWideSetupStop(code, message));
    if (skip) return;
    await patchModelAvailability({ id: allowed.model, provider: allowed.provider }, {
      verification: { ok, code, scope, checkedAt: new Date().toISOString() },
    }, opts.userId);
    if (opts.touchCatalogCache !== false) invalidateModelCatalogCache();
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();
  const signal = opts.signal ? AbortSignal.any([controller.signal, opts.signal]) : controller.signal;
  try {
    const stream = streamExactly(allowed.provider, allowed.model, [
      { role: "user", content: "Reply with the single word: OK" },
    ], signal);

    let sample = "";
    const collect = (async () => {
      for await (const chunk of stream) {
        sample += chunk;
        if (sample.trim()) break;
      }
    })();

    await Promise.race([
      collect,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error("Request timed out"));
          controller.abort();
        }, TIMEOUT_MS);
      }),
    ]);

    const latencyMs = Date.now() - started;
    const text = sample.trim();
    if (!text) {
      await saveCheck(false, "empty_response");
      return {
        ok: false,
        modelId: allowed.model,
        provider: allowed.provider,
        latencyMs,
        code: "empty_response",
        message: "The model connected but returned no text.",
        remediation: "Try another model; this one may not support streaming chat.",
      };
    }

    await saveCheck(true);
    return {
      ok: true,
      modelId: allowed.model,
      provider: allowed.provider,
      latencyMs,
      sample: text.slice(0, MAX_SAMPLE_CHARS),
    };
  } catch (err) {
    const d = diagnoseModelTestError(err, allowed.provider, allowed.model);
    await saveCheck(false, d.code, d.message);
    return {
      ok: false,
      modelId: allowed.model,
      provider: allowed.provider,
      latencyMs: Date.now() - started,
      ...d,
    };
  } finally {
    controller.abort();
    clearTimeout(timer);
  }
}
