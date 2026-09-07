/**
 * Server-side model allowlist.
 *
 * A browser may express a model *preference*, but the server decides whether
 * that id is permitted and which provider runs it. Without this, a crafted
 * request could name any model string and have it forwarded to a provider.
 */

import { builtinChatModels } from "./router";
import { getModelCatalogCached } from "./catalog";
import { BEDROCK_TEXT_MODELS, isBedrockRestrictedAccessId, isChatUsableModelId } from "./catalog-shared";
import type { ModelProvider } from "./types";

export type AllowedModel = {
  model: string;
  provider: ModelProvider;
};

/**
 * Resolve a requested model id to an allowed model + provider, or null when the
 * id is not permitted. Never throws — callers fall back to router selection.
 */
export async function resolveAllowedModel(
  requested: string | undefined | null,
): Promise<AllowedModel | null> {
  const id = requested?.trim();
  if (!id) return null;
  if (isBedrockRestrictedAccessId(id) || !isChatUsableModelId(id)) return null;

  const builtins = builtinChatModels();
  const builtinProvider = builtins.get(id);
  if (builtinProvider) {
    return { model: id, provider: builtinProvider };
  }

  const bedrockFallback = BEDROCK_TEXT_MODELS.find(m => m.id === id);
  if (bedrockFallback) {
    return { model: bedrockFallback.id, provider: "bedrock" };
  }

  try {
    const catalog = await getModelCatalogCached();
    const hit =
      catalog.groq.find(m => m.id === id) ??
      catalog.bedrock.find(m => m.id === id) ??
      catalog.ollama.find(m => m.id === id) ??
      catalog.openai.find(m => m.id === id) ??
      catalog.anthropic.find(m => m.id === id) ??
      catalog.google.find(m => m.id === id);
    if (hit && hit.modality !== "other" && isChatUsableModelId(hit.id) && hit.access !== "needs_enablement") {
      return { model: hit.id, provider: hit.provider };
    }
  } catch {
    // Catalog unavailable — fall through to deny.
  }

  return null;
}
