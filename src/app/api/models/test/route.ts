export const runtime = "nodejs";

/**
 * Reachability check for a single model.
 *
 * Bedrock in particular lists far more models than an account can actually
 * invoke: access is granted per model, some ids are region-specific, and some
 * need an inference profile. Rather than making the operator discover that
 * mid-conversation, this sends the smallest possible prompt and reports either
 * a real token or a specific, actionable reason.
 *
 * Admin-only: it spends money, however little.
 */

import { NextRequest } from "next/server";
import { getIdentity, identityErrorResponse } from "@/lib/identity";
import { requireAdmin } from "@/lib/roles";
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

/** Cap the reply: this proves reachability, it does not need to say anything. */
const MAX_SAMPLE_CHARS = 80;
const TIMEOUT_MS = 30_000;

/**
 * Dispatch straight to the provider — deliberately not `streamChat()`, whose
 * fallback chain would let Groq answer a Bedrock test and report success for a
 * model that cannot actually be invoked.
 */
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

export async function POST(req: NextRequest) {
  try {
    const identity = await getIdentity(req);
    requireAdmin(identity);

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const modelId = typeof body.modelId === "string" ? body.modelId.trim() : "";
    if (!modelId) {
      return Response.json({ error: "modelId is required" }, { status: 400 });
    }

    // Resolve provider identity from the live server catalog. Tests may retry
    // unverified or failed entries, but never invoke an arbitrary browser id.
    const allowed = await resolveAllowedModel(modelId, {
      forTest: true,
      provider: typeof body.provider === "string" ? body.provider : undefined,
    });
    if (!allowed) {
      return Response.json(
        {
          ok: false,
          modelId,
          code: "not_allowlisted",
          message: "This model is not in the server-side allowlist.",
          remediation: "Refresh the catalog, or check that its provider is still configured.",
        },
        { status: 200 },
      );
    }

    const started = Date.now();
    const scope = await modelCredentialScope(allowed.provider);
    const saveCheck = async (ok: boolean, code?: string) => {
      await patchModelAvailability({ id: allowed.model, provider: allowed.provider }, {
        verification: { ok, code, scope, checkedAt: new Date().toISOString() },
      }, identity.userId);
      invalidateModelCatalogCache();
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    try {
      const stream = streamExactly(allowed.provider, allowed.model, [
        { role: "user", content: "Reply with the single word: OK" },
      ], AbortSignal.any([controller.signal, req.signal]));

      let sample = "";
      const collect = (async () => {
        for await (const chunk of stream) {
          sample += chunk;
          if (sample.trim()) break;
        }
      })();

      await Promise.race([
        collect,
        new Promise<never>((_, reject) =>
          { timer = setTimeout(() => {
            reject(new Error("Request timed out"));
            controller.abort();
          }, TIMEOUT_MS); },
        ),
      ]);

      const latencyMs = Date.now() - started;
      const text = sample.trim();
      if (!text) {
        await saveCheck(false, "empty_response");
        return Response.json({
          ok: false,
          modelId: allowed.model,
          provider: allowed.provider,
          latencyMs,
          code: "empty_response",
          message: "The model connected but returned no text.",
          remediation: "Try another model; this one may not support streaming chat.",
        });
      }

      await saveCheck(true);
      return Response.json({
        ok: true,
        modelId: allowed.model,
        provider: allowed.provider,
        latencyMs,
        sample: text.slice(0, MAX_SAMPLE_CHARS),
      });
    } catch (err) {
      const d = diagnoseModelTestError(err, allowed.provider, allowed.model);
      await saveCheck(false, d.code);
      return Response.json({
        ok: false,
        modelId: allowed.model,
        provider: allowed.provider,
        latencyMs: Date.now() - started,
        ...d,
      });
    } finally {
      controller.abort();
      clearTimeout(timer);
    }
  } catch (err) {
    const res = identityErrorResponse(err);
    if (res) return res;
    throw err;
  }
}
