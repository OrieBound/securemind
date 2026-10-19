/**
 * One-time access check after a vendor key is saved.
 *
 * Listing models only proves the key can see a catalog. Chat menus include a
 * model after one successful short request. Checks are stored against the
 * credential fingerprint, so the same key is not probed again. A new key is a
 * new fingerprint.
 */

import { isChatUsableModelId, type CatalogModel } from "./catalog-shared";

/** Failures that mean the account or network, not this one model. */
export function isAccountWideSetupStop(code: string | undefined, message?: string | null): boolean {
  if (code === "quota_or_billing") return true;
  const text = message ?? "";
  return /unreachable|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|getaddrinfo|fetch failed|network/i.test(text);
}

/**
 * Chat models with no current check for this key. Already checked models stay put.
 *
 * With `recheckBefore` (a timestamp in ms, the moment a re-check began), models whose last check
 * failed and is older than that are tried again. That is how a key that has run out of credit, or
 * been replaced at the provider, is looked at a second time. Each model is tried once per run,
 * because a check made during the run is newer than the timestamp.
 */
export function modelsAwaitingSetupCheck(
  models: CatalogModel[],
  options: { recheckBefore?: number } = {},
): CatalogModel[] {
  const { recheckBefore } = options;
  const staleFailure = (model: CatalogModel) =>
    recheckBefore !== undefined &&
    model.verification === "failed" &&
    (!model.checkedAt || Date.parse(model.checkedAt) < recheckBefore);
  return models
    .filter(model =>
      model.modality !== "other" &&
      !model.hidden &&
      model.access !== "needs_enablement" &&
      (model.verification === undefined || model.verification === "unverified" || staleFailure(model)) &&
      isChatUsableModelId(model.id),
    )
    .sort((a, b) => a.id.localeCompare(b.id));
}
