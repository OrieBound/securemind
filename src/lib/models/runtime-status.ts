/**
 * First-run / dependency status. Probes Ollama tags only — never Groq/Bedrock
 * model lists and never pulls weights.
 */

import { resolveRuntimeSecrets } from "@/lib/instance-config";
import { bedrockBlockReason, isBedrockConfigured } from "@/lib/models/bedrock";
import { getGroqUnavailableReason, hasGroqRuntime, selectGroqApiKey } from "@/lib/models/groq";
import { isOllamaEmbedModel, probeOllama } from "@/lib/models/ollama";
import { routeModel } from "@/lib/models/router";
import {
  decideChatRuntime,
  type ChatSetupGuidance,
} from "@/lib/models/resolve-chat-runtime";
import { probeHardware } from "@/lib/models/local-recommendations";
import { runtimeEdition, runtimeDeployment } from "@/lib/runtime-env";
import { SUPPORTED_DOC_FORMATS_SHORT } from "@/lib/documents/constants";
import { pickImageExtractBackend } from "@/lib/image-extract";
import { pickTranscribeBackend, transcribeUnavailableMessage } from "@/lib/transcribe/backend";
import { transcribeStreamConfig } from "@/lib/transcribe/stream-session";

export type RuntimeStatus = {
  edition: "local" | "cloud";
  deployment: "docker" | "host" | "hosted";
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
    voiceStt: {
      ready: boolean;
      provider: "transcribe" | "groq" | null;
      choice: "transcribe" | "groq" | null;
      /** Hosted only: the browser can stream the mic straight to Amazon Transcribe and show words as they are spoken. */
      directLive: boolean;
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

  const imageBackend = pickImageExtractBackend({ edition, groqOk, bedrockOk });
  const imageNote =
    imageBackend === "bedrock"
      ? "Image text extract uses Amazon Bedrock. Pixels leave this host to AWS; extracted text is scanned before storage. Groq is not required."
      : imageBackend === "groq"
        ? "Image text extract uses a Groq vision model. Pixels leave this host; extracted text is scanned before storage."
        : "Image text extract needs Amazon Bedrock or an optional Groq key. Upload a text document instead — images are not used to discover sensitive values without a vision provider.";

  const groqKeyOk = Boolean(selectGroqApiKey(secrets));
  const voiceChoice = secrets.voiceSttChoice;
  const voiceBackend = pickTranscribeBackend({
    edition,
    groqOk: groqKeyOk,
    awsOk: bedrockOk,
    choice: voiceChoice,
    audioAcked: secrets.voiceSttAudioAcked,
  });
  const voiceNote =
    voiceBackend === "transcribe"
      ? "Voice uses Amazon Transcribe Streaming (IAM) in this AWS account — the same account as Bedrock. Spoken audio is sent to AWS before any redaction. Chat detection runs on the resulting text when you send."
      : voiceBackend === "groq"
        ? "Voice uses Groq Whisper. Spoken audio is sent to Groq Cloud; SecureMind does not control where Groq processes it. Chat detection runs on the resulting text when you send."
        : transcribeUnavailableMessage({
            choice: voiceChoice,
            groqOk: groqKeyOk,
            awsOk: bedrockOk,
            audioAcked: secrets.voiceSttAudioAcked,
          });

  return {
    edition,
    deployment: runtimeDeployment(),
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
        ready: imageBackend != null,
        sendsPixelsOffHost: imageBackend != null,
        note: imageNote,
      },
      voiceStt: {
        ready: voiceBackend != null,
        provider: voiceBackend,
        choice: voiceChoice,
        directLive: edition === "cloud" && voiceBackend === "transcribe" && transcribeStreamConfig() !== null,
        note: voiceNote,
      },
      embeddings: {
        ready: embedReady,
        provider: embedReady ? (edition === "cloud" ? "bedrock" : "ollama") : null,
      },
    },
    model: decision.ok
      ? {
          provider: decision.provider,
          model:
            decision.provider === "bedrock" && decision.source === "bedrock"
              ? (secrets.bedrockChatModel?.trim() || null)
              : decision.model,
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
