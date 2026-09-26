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

/** Chat models with no current check for this key. Already checked models stay put. */
export function modelsAwaitingSetupCheck(models: CatalogModel[]): CatalogModel[] {
  return models
    .filter(model =>
      model.modality !== "other" &&
      !model.hidden &&
      model.access !== "needs_enablement" &&
      (model.verification === undefined || model.verification === "unverified") &&
      isChatUsableModelId(model.id),
    )
    .sort((a, b) => a.id.localeCompare(b.id));
}
