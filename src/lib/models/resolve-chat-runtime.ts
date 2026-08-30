/**
 * Decide whether this turn can reach a model — without downloading weights
 * and without silently using a product-operated third-party LLM.
 */

import type { ModelProvider } from "./types";
import type { PrimaryProvider } from "@/lib/instance-config";
import type { RuntimeEdition } from "@/lib/runtime-env";
import {
  LOCAL_QUALITY_NOTE,
  REMOTE_INFERENCE_NOTE,
  recommendLocalModels,
  type HardwareSnapshot,
  type LocalModelRecommendation,
} from "./local-recommendations";
import { isOllamaEmbedModel, resolveOllamaChatModel } from "./ollama";

export const MODEL_PROVIDER_REQUIRED_CODE = "MODEL_PROVIDER_REQUIRED";
export const MODEL_NOT_ASSIGNED_CODE = "MODEL_NOT_ASSIGNED";

export const MODEL_PROVIDER_REQUIRED_TITLE = "Model provider required";

export type ChatSetupGuidance = {
  edition: RuntimeEdition;
  title: string;
  message: string;
  settingsSection: "providers";
  qualityNote: string;
  remoteNote: string | null;
  ollama: {
    reachable: boolean;
    installedChatModels: string[];
    recommendation: LocalModelRecommendation;
    hardware: HardwareSnapshot;
  } | null;
  cloud: {
    recommended: "bedrock";
    byok: string[];
  } | null;
};

export type ChatRuntimeOk = {
  ok: true;
  provider: ModelProvider;
  model: string;
  useGroq: boolean;
  useBedrock: boolean;
  source: "override" | "groq" | "bedrock" | "ollama-installed" | "vision";
};

export type ChatRuntimeBlocked = {
  ok: false;
  code: string;
  message: string;
  setupRequired: true;
  settingsSection: "providers";
  setup: ChatSetupGuidance;
};

export type ChatRuntimeDecision = ChatRuntimeOk | ChatRuntimeBlocked;

export type ChatRuntimeInput = {
  edition: RuntimeEdition;
  routedProvider: ModelProvider;
  routedModel: string;
  activeMode: string;
  hasImages: boolean;
  primaryProvider: PrimaryProvider;
  groqOk: boolean;
  groqBlock: null | "vendor_risk_required" | "missing_key";
  bedrockOk: boolean;
  bedrockBlock: string | null;
  ollamaReachable: boolean;
  ollamaChatModels: string[];
  hardware: HardwareSnapshot;
  override?: { provider: ModelProvider; model: string } | null;
};

function localSetup(input: ChatRuntimeInput, extra: string): ChatSetupGuidance {
  const recommendation = recommendLocalModels(input.hardware, input.ollamaChatModels);
  return {
    edition: "local",
    title: MODEL_PROVIDER_REQUIRED_TITLE,
    message: extra,
    settingsSection: "providers",
    qualityNote: LOCAL_QUALITY_NOTE,
    remoteNote: null,
    ollama: {
      reachable: input.ollamaReachable,
      installedChatModels: input.ollamaChatModels,
      recommendation,
      hardware: input.hardware,
    },
    cloud: null,
  };
}

function cloudSetup(input: ChatRuntimeInput, extra: string): ChatSetupGuidance {
  return {
    edition: "cloud",
    title: MODEL_PROVIDER_REQUIRED_TITLE,
    message: extra,
    settingsSection: "providers",
    qualityNote: LOCAL_QUALITY_NOTE,
    remoteNote: REMOTE_INFERENCE_NOTE,
    ollama: null,
    cloud: {
      recommended: "bedrock",
      byok: ["Groq", "OpenAI", "Anthropic", "Google"],
    },
  };
}

function blocked(input: ChatRuntimeInput, code: string, message: string): ChatRuntimeBlocked {
  return {
    ok: false,
    code,
    message,
    setupRequired: true,
    settingsSection: "providers",
    setup: input.edition === "cloud" ? cloudSetup(input, message) : localSetup(input, message),
  };
}

function okOllama(model: string): ChatRuntimeOk {
  return {
    ok: true,
    provider: "ollama",
    model,
    useGroq: false,
    useBedrock: false,
    source: "ollama-installed",
  };
}

function tryInstalledOllama(input: ChatRuntimeInput, requested?: string): ChatRuntimeOk | null {
  if (!input.ollamaReachable || input.ollamaChatModels.length === 0) return null;
  if (requested && !isOllamaEmbedModel(requested)) {
    const want = requested.trim().toLowerCase();
    const hit = input.ollamaChatModels.find(t => t.toLowerCase() === want || t.toLowerCase().startsWith(`${want}:`));
    if (hit) return okOllama(hit);
  }
  const rec = recommendLocalModels(input.hardware, input.ollamaChatModels);
  if (rec.useInstalled) return okOllama(rec.useInstalled);
  return null;
}

function groqUnavailableMessage(input: ChatRuntimeInput): { code: string; message: string } {
  if (input.groqBlock === "vendor_risk_required") {
    return {
      code: "VENDOR_RISK_REQUIRED",
      message:
        "Vendor APIs are blocked until you acknowledge the risk in Settings → Providers. " +
        (input.edition === "local"
          ? "You can also use an installed Ollama chat model."
          : "On this deployment, enable Amazon Bedrock (IAM) or add a bring-your-own provider key."),
    };
  }
  if (input.edition === "cloud") {
    return {
      code: MODEL_PROVIDER_REQUIRED_CODE,
      message:
        "No model provider is configured. Enable Amazon Bedrock with this deployment's IAM role, " +
        "or add a bring-your-own provider key in Settings → Providers. " +
        "SecureMind does not use a product-operated third-party model by default.",
    };
  }
  return {
    code: MODEL_PROVIDER_REQUIRED_CODE,
    message: input.ollamaReachable
      ? "No compatible Ollama chat model is installed. Pull a local model below, or add a cloud provider in Settings."
      : "No model provider is ready. Install Ollama from ollama.com/download and pull a chat model, or add a cloud provider in Settings.",
  };
}

/**
 * Pure routing gate used by chat prepare and the runtime status endpoint.
 * Never pulls models. Never selects a hosted third-party LLM unless the
 * operator configured it (Groq BYOK / Bedrock IAM).
 */
export function decideChatRuntime(input: ChatRuntimeInput): ChatRuntimeDecision {
  if (input.hasImages) {
    if (input.groqOk) {
      return {
        ok: true,
        provider: "groq",
        model: input.routedModel,
        useGroq: true,
        useBedrock: false,
        source: "vision",
      };
    }
    return blocked(
      input,
      MODEL_PROVIDER_REQUIRED_CODE,
      "Image chat needs a configured vision-capable provider. " +
        "Detection still runs on text locally; pixels are not used as a sensitivity scanner.",
    );
  }

  if (input.override) {
    const { provider, model } = input.override;
    if (provider === "groq") {
      if (input.groqOk) {
        return { ok: true, provider, model, useGroq: true, useBedrock: false, source: "override" };
      }
      const { code, message } = groqUnavailableMessage(input);
      return blocked(input, code, message);
    }
    if (provider === "bedrock") {
      if (input.bedrockOk) {
        return { ok: true, provider, model, useGroq: false, useBedrock: true, source: "override" };
      }
      return blocked(
        input,
        "BEDROCK_NOT_CONFIGURED",
        input.bedrockBlock ?? "Amazon Bedrock is not configured for this installation.",
      );
    }
    if (provider === "ollama") {
      if (isOllamaEmbedModel(model)) {
        return blocked(
          input,
          "OLLAMA_EMBED_MODEL",
          `"${model}" is an embedding model and cannot be used for chat. Remap this tier to a chat model.`,
        );
      }
      const resolved = resolveOllamaChatModel(model, input.activeMode);
      const local = tryInstalledOllama(input, resolved);
      if (local) return { ...local, source: "override", model: local.model };
      return blocked(
        input,
        "OLLAMA_MODEL_MISSING",
        input.ollamaReachable
          ? `Model "${resolved}" is not installed. Pull it from the setup panel or run: ollama pull ${resolved}`
          : "Ollama is not running. Install from https://ollama.com/download then start the app.",
      );
    }
    return { ok: true, provider, model, useGroq: false, useBedrock: false, source: "override" };
  }

  const primary = input.primaryProvider;

  if (primary === "bedrock" || (primary === "auto" && input.edition === "cloud" && input.bedrockOk)) {
    if (input.bedrockOk) {
      return {
        ok: true,
        provider: "bedrock",
        model: input.routedModel,
        useGroq: false,
        useBedrock: true,
        source: "bedrock",
      };
    }
    const local = tryInstalledOllama(input);
    if (local && input.edition === "local") return local;
    return blocked(
      input,
      "BEDROCK_NOT_CONFIGURED",
      input.bedrockBlock ?? "Amazon Bedrock is not configured for this installation.",
    );
  }

  if (primary === "ollama") {
    const local = tryInstalledOllama(input, input.routedModel);
    if (local) return local;
    return blocked(
      input,
      MODEL_PROVIDER_REQUIRED_CODE,
      groqUnavailableMessage(input).message,
    );
  }

  if (primary === "groq") {
    if (input.groqOk) {
      return {
        ok: true,
        provider: "groq",
        model: input.routedModel,
        useGroq: true,
        useBedrock: false,
        source: "groq",
      };
    }
    const local = tryInstalledOllama(input);
    if (local && input.edition === "local") return local;
    const { code, message } = groqUnavailableMessage(input);
    return blocked(input, code, message);
  }

  // primary === "auto"
  if (input.edition === "cloud") {
    if (input.bedrockOk) {
      return {
        ok: true,
        provider: "bedrock",
        model: input.routedModel,
        useGroq: false,
        useBedrock: true,
        source: "bedrock",
      };
    }
    if (input.groqOk) {
      return {
        ok: true,
        provider: "groq",
        model: input.routedModel,
        useGroq: true,
        useBedrock: false,
        source: "groq",
      };
    }
    const { code, message } = groqUnavailableMessage(input);
    return blocked(input, code, message);
  }

  if (input.groqOk) {
    return {
      ok: true,
      provider: "groq",
      model: input.routedModel,
      useGroq: true,
      useBedrock: false,
      source: "groq",
    };
  }

  const local = tryInstalledOllama(input, input.routedModel);
  if (local) return local;

  if (input.bedrockOk) {
    return {
      ok: true,
      provider: "bedrock",
      model: input.routedModel,
      useGroq: false,
      useBedrock: true,
      source: "bedrock",
    };
  }

  const { code, message } = groqUnavailableMessage(input);
  return blocked(input, code, message);
}
