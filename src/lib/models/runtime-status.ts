/**
 * First-run / dependency status. Probes Ollama tags only — never Groq/Bedrock
 * model lists and never pulls weights.
 */

import { resolveRuntimeSecrets } from "@/lib/instance-config";
import { bedrockBlockReason, isBedrockConfigured } from "@/lib/models/bedrock";
import { getGroqUnavailableReason, hasGroqRuntime } from "@/lib/models/groq";
import { isOllamaEmbedModel, probeOllama } from "@/lib/models/ollama";
import { routeModel } from "@/lib/models/router";
import {
  decideChatRuntime,
  MODEL_PROVIDER_REQUIRED_CODE,
  type ChatSetupGuidance,
} from "@/lib/models/resolve-chat-runtime";
import { probeHardware } from "@/lib/models/local-recommendations";
import { runtimeEdition } from "@/lib/runtime-env";
import { SUPPORTED_DOC_FORMATS_SHORT } from "@/lib/documents/constants";

export type RuntimeStatus = {
  edition: "local" | "cloud";
  chatReady: boolean;
  code: string | null;
  capabilities: {
    detection: { ready: true; label: string };
    documentParsing: { ready: true; formats: string[] };
    imageOcr: {
      ready: boolean;
      sendsPixelsOffHost: boolean;
      note: string;
    };
    embeddings: { ready: boolean; provider: "ollama" | "bedrock" | null };
  };
  model: {
    provider: string | null;
    model: string | null;
    connected: boolean;
    source: string | null;
  };
  setup: ChatSetupGuidance | null;
};

export async function getRuntimeStatus(): Promise<RuntimeStatus> {
  const edition = runtimeEdition();
  const [secrets, groqOk, groqBlock, bedrockOk, bedrockBlock, ollama, hardware] =
    await Promise.all([
      resolveRuntimeSecrets(),
      hasGroqRuntime(),
      getGroqUnavailableReason(),
      isBedrockConfigured(),
      bedrockBlockReason(),
      probeOllama(2500),
      Promise.resolve(probeHardware()),
    ]);

  const ollamaChatModels = ollama.tags.filter(t => !isOllamaEmbedModel(t));
  const routed = routeModel("chat", undefined);
  const decision = decideChatRuntime({
    edition,
    routedProvider: routed.provider,
    routedModel: routed.model,
    activeMode: "Standard",
    hasImages: false,
    primaryProvider: secrets.primaryProvider,
    groqOk,
    groqBlock,
    bedrockOk,
    bedrockBlock,
    ollamaReachable: ollama.reachable,
    ollamaChatModels,
    hardware,
    override: null,
  });

  const embedReady =
    (edition === "local" && ollama.tags.some(t => isOllamaEmbedModel(t))) ||
    (edition === "cloud" && bedrockOk);

  return {
    edition,
    chatReady: decision.ok,
    code: decision.ok ? null : decision.code,
    capabilities: {
      detection: {
        ready: true,
        label: "Pattern detection (PII, secrets) runs on this installation",
      },
      documentParsing: {
        ready: true,
        formats: SUPPORTED_DOC_FORMATS_SHORT.split(",").map(s => s.trim()),
      },
      imageOcr: {
        ready: groqOk,
        sendsPixelsOffHost: groqOk,
        note: groqOk
          ? "Image text extract uses a vision model. Pixels leave this host; extracted text is scrubbed before storage."
          : "Image text extract is unavailable until a vision-capable provider is configured. Images are not used to discover sensitive values.",
      },
      embeddings: {
        ready: embedReady,
        provider: embedReady ? (edition === "cloud" ? "bedrock" : "ollama") : null,
      },
    },
    model: decision.ok
      ? {
          provider: decision.provider,
          model: decision.model,
          connected: true,
          source: decision.source,
        }
      : {
          provider: null,
          model: null,
          connected: false,
          source: null,
        },
    setup: decision.ok ? null : decision.setup,
  };
}

export function isModelProviderRequired(code: string | null | undefined): boolean {
  return code === MODEL_PROVIDER_REQUIRED_CODE;
}
