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
  /**
   * Bedrock only. `needs_enablement` = this region lists the model, but the AWS
   * account still has to turn it on. Chat pickers omit these; Settings still
   * shows them with a flag.
   */
  access?: "ready" | "needs_enablement";
};

/** Operator copy when Bedrock lists a model that is not enabled on this account. */
export const BEDROCK_ENABLE_IN_CONSOLE_NOTE =
  "Open Amazon Bedrock (same region) → Discover → Model catalog → this model. For Anthropic, complete the first-time use-case form if asked. Do not use Tune → Marketplace model deployments — that page is for third-party endpoint models, not Claude.";

/** When AWS refuses invoke with “not available for this account”. */
export const BEDROCK_NOT_ENTITLED_REMEDIATION =
  "AWS listed this id but will not run it for this account — that is not an IAM role problem. In the Bedrock console go to Discover → Model catalog (not Marketplace deployments). Open the Anthropic model: if this account has never used Anthropic, submit the first-time use-case form. If the catalog still says it is not available for this account (or to contact Sales), this account cannot use that id. Use a model that already works (for example a Sonnet that Tested OK). Chat may show a friendly name such as Opus 5 while the AWS error names a different id such as Claude 4.7.";

/** Minimal Bedrock fallback when ListFoundationModels is denied — server catalog only. */
export const BEDROCK_TEXT_MODELS: CatalogModel[] = [
  {
    id: "amazon.nova-pro-v1:0",
    name: "Amazon Nova Pro",
    provider: "bedrock",
    modality: "text",
    note: "Fallback list until this UI can list models — open Amazon Bedrock → Discover → Model catalog",
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
  /whisper|tts|embed|orpheus|prompt-guard|safeguard|lyria|imagen|veo-|computer-use|nano-banana|robotics|deep-research|antigravity|clip-preview|dall-e|gpt-image|sora-|transcribe|moderation|sonic/;

const RETIRED_CHAT_IDS = new Set([
  "gemini-2.5-flash",
  "gemini-2.5-pro",
]);

/**
 * Bedrock ids AWS does not open to every account (Sales grant or invite).
 * ListFoundationModels still returns them, and GetFoundationModelAvailability
 * often reports AVAILABLE, but Playground/Converse then returns “not available
 * for this account”. They must not appear in Chat or complexity-tier pickers.
 *
 * Opus 5 only — not Claude 3 Opus, not Opus 4.5 / 4-5. Mythos is invite-only.
 */
export function isBedrockRestrictedAccessId(id: string): boolean {
  const core = id
    .trim()
    .toLowerCase()
    .replace(/^models\//, "")
    .replace(/^(us|eu|apac|jp|au|global)\./, "");
  if (!core) return false;
  if (core.includes("claude-mythos")) return true;
  return /(?:^|[./])claude-opus-5(?:$|[^0-9])/.test(core);
}

/** Operator-facing copy when ListFoundationModels fails. */
export function formatBedrockCatalogError(
  err: unknown,
  edition: "local" | "cloud",
): string {
  const name = err instanceof Error ? err.name : "error";
  const accessDenied = /AccessDenied|not authorized/i.test(
    `${name} ${err instanceof Error ? err.message : ""}`,
  );
  if (edition === "cloud" && accessDenied) {
    return (
      `Bedrock catalog unavailable (${name}) — showing Amazon Nova Pro, Lite, and Micro as a fallback. ` +
      `You do not create an IAM role by hand. Terraform already put invoke on the chat Lambda role; ` +
      `the next apply attaches list/invoke to this UI’s Amplify role so the full catalog can load. ` +
      `Separately, open Amazon Bedrock → Discover → Model catalog to enable a model — that is not IAM. Do not use Marketplace model deployments for Anthropic Claude.`
    );
  }
  return (
    `Bedrock catalog unavailable (${name}) — showing a minimal fallback list. ` +
    `Grant bedrock:ListFoundationModels for the full catalog.`
  );
}

export function isChatUsableModelId(id: string): boolean {
  const lower = id.trim().toLowerCase().replace(/^models\//, "");
  if (!lower) return false;
  if (RETIRED_CHAT_IDS.has(lower)) return false;
  if (isBedrockRestrictedAccessId(lower)) return false;
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
