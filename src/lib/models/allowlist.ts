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
import { getModelAvailability } from "./model-availability-store";
import { modelKey } from "./model-availability";
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
  options?: { forTest: true; provider?: string },
): Promise<AllowedModel | null> {
  const id = requested?.trim();
  if (!id) return null;
  if (isBedrockRestrictedAccessId(id) || !isChatUsableModelId(id)) return null;

  const builtins = builtinChatModels();
  const builtinProvider = builtins.get(id);
  if (builtinProvider && !options?.forTest) {
    if (await adminHid(builtinProvider, id)) return null;
    return { model: id, provider: builtinProvider };
  }

  const bedrockFallback = BEDROCK_TEXT_MODELS.find(m => m.id === id);
  if (bedrockFallback && !options?.forTest) {
    if (await adminHid("bedrock", id)) return null;
    return { model: bedrockFallback.id, provider: "bedrock" };
  }

  try {
    const catalog = await getModelCatalogCached();
    const hit = [catalog.groq, catalog.bedrock, catalog.ollama, catalog.openai, catalog.anthropic, catalog.google, catalog.xai]
      .flatMap(bucket => bucket ?? [])
      .find(m => m.id === id && (!options?.provider || m.provider === options.provider));
    // A model the Admin hid is out of the menus; a crafted request must not bring it back.
    // Tests still run on hidden models so an Admin can check one before showing it again.
    if (hit && hit.modality !== "other" && isChatUsableModelId(hit.id) &&
        (options?.forTest || (hit.access !== "needs_enablement" && hit.verification !== "failed" && !hit.hidden))) {
      return { model: hit.id, provider: hit.provider };
    }
  } catch {
    // Catalog unavailable — fall through to deny.
  }

  return null;
}

/** True when an Admin hid this model. A storage error keeps the old behaviour (allowed). */
async function adminHid(provider: ModelProvider, id: string): Promise<boolean> {
  try {
    const records = await getModelAvailability();
    return records[modelKey({ provider, id })]?.hidden === true;
  } catch {
    return false;
  }
}
