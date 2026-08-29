/**
 * Client-safe catalog types and static fallback lists.
 * Keep this file free of server-only imports (AWS SDK, db, etc.).
 */

export type CatalogModel = {
  id: string;
  name: string;
  provider: "groq" | "bedrock" | "ollama" | "openai" | "anthropic" | "google";
  modality: "text" | "vision" | "other";
  note?: string;
};

/** Minimal Bedrock fallback when ListFoundationModels is denied — server catalog only. */
export const BEDROCK_TEXT_MODELS: CatalogModel[] = [
  {
    id: "amazon.nova-pro-v1:0",
    name: "Amazon Nova Pro",
    provider: "bedrock",
    modality: "text",
    note: "Fallback list — grant bedrock:ListFoundationModels for the full catalog",
  },
  {
    id: "amazon.nova-lite-v1:0",
    name: "Amazon Nova Lite",
    provider: "bedrock",
    modality: "text",
    note: "Fallback list",
  },
  {
    id: "amazon.nova-micro-v1:0",
    name: "Amazon Nova Micro",
    provider: "bedrock",
    modality: "text",
    note: "Fallback list",
  },
];

export type ModelCatalogBuckets = {
  groq: CatalogModel[];
  bedrock: CatalogModel[];
  ollama: CatalogModel[];
  openai: CatalogModel[];
  anthropic: CatalogModel[];
  google: CatalogModel[];
};

/**
 * IDs that vendors list as generate/text but cannot run SecureMind chat
 * (TTS, embeddings, image, audio, prompt-guard, retired Gemini 2.5 Flash/Pro).
 * Vision chat models such as Llama 4 Scout stay usable.
 */
const NON_CHAT_ID =
  /whisper|tts|embed|orpheus|prompt-guard|safeguard|lyria|imagen|veo-|computer-use|nano-banana|robotics|deep-research|antigravity|clip-preview|dall-e|gpt-image|sora-|transcribe|moderation/;

const RETIRED_CHAT_IDS = new Set([
  "gemini-2.5-flash",
  "gemini-2.5-pro",
]);

export function isChatUsableModelId(id: string): boolean {
  const lower = id.trim().toLowerCase().replace(/^models\//, "");
  if (!lower) return false;
  if (RETIRED_CHAT_IDS.has(lower)) return false;
  if (NON_CHAT_ID.test(lower)) return false;
  if (lower.includes("audio") && !lower.includes("gpt-oss")) return false;
  if (/(^|[-/])image($|[-/])/.test(lower) || lower.includes("-image-") || lower.endsWith("-image")) {
    return false;
  }
  return true;
}

/** Classify a listed model id. "other" is never offered for chat. */
export function modalityForListedModel(id: string): CatalogModel["modality"] {
  if (!isChatUsableModelId(id)) return "other";
  const lower = id.toLowerCase();
  if (lower.includes("vision") || lower.includes("scout") || lower.includes("pixtral")) {
    return "vision";
  }
  return "text";
}
