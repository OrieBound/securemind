import type { CatalogModel } from "./catalog-shared";

export const VERIFICATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export type ModelAvailabilityRecord = {
  hidden?: boolean;
  verification?: { ok: boolean; checkedAt: string; scope: string; code?: string };
};
export type ModelAvailabilityMap = Record<string, ModelAvailabilityRecord>;

export function modelKey(model: Pick<CatalogModel, "provider" | "id">): string {
  return `${model.provider}:${model.id}`;
}

export function withModelAvailability(
  model: CatalogModel,
  record: ModelAvailabilityRecord | undefined,
  scope: string,
  now = Date.now(),
): CatalogModel {
  const check = record?.verification;
  const age = check ? now - Date.parse(check.checkedAt) : Infinity;
  const current = check && check.scope === scope && age >= 0 && age < VERIFICATION_TTL_MS;
  return {
    ...model,
    hidden: record?.hidden === true,
    verification: current ? (check.ok ? "verified" : "failed")
      : model.provider === "ollama" && model.verification === "installed" ? "installed" : "unverified",
    checkedAt: current ? check.checkedAt : undefined,
    verificationCode: current ? check.code : undefined,
  };
}

export type ModelSelectionStatus = { ready: boolean; notForChat: boolean; label?: string };

/** Chat menus use a passed test or an installed local model. Untested cloud models stay in Settings. */
export function catalogSelectionStatus(model: CatalogModel): ModelSelectionStatus {
  if (model.modality === "other") return { ready: false, notForChat: true, label: "Not for chat" };
  if (model.hidden) return { ready: false, notForChat: false, label: "Hidden" };
  if (model.access === "needs_enablement") return { ready: false, notForChat: false, label: "Enable in AWS" };
  if (model.verification === "failed") return { ready: false, notForChat: false, label: "Check failed" };
  if (model.verification === "verified" || model.verification === "installed") {
    return { ready: true, notForChat: false };
  }
  return { ready: false, notForChat: false, label: "Not in menus" };
}
