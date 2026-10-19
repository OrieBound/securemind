/**
 * What the model checks say about one vendor key.
 *
 * Saving a key only proves it was pasted. Whether it still works shows up in the short test each
 * model gets. This reads those results and names the problem in plain words, so a key that has
 * expired, been revoked or run out of credit is not shown as simply "Connected".
 */

import { isChatUsableModelId, type CatalogModel } from "./catalog-shared";

export type KeyHealthState = "working" | "unchecked" | "no_quota" | "rejected" | "rate_limited" | "failing";

export type KeyHealth = {
  state: KeyHealthState;
  /** Short label for a badge. */
  label: string;
  /** One or two sentences: what it means and what to do. */
  detail: string;
  /** When the newest check ran, if any. */
  checkedAt?: string;
  working: number;
  failed: number;
  unchecked: number;
};

/** The states that need the operator to act. */
export function keyNeedsAttention(health: KeyHealth | null | undefined): boolean {
  return Boolean(health) && ["no_quota", "rejected", "rate_limited", "failing"].includes(health!.state);
}

function relevant(model: CatalogModel): boolean {
  return model.modality !== "other" && !model.hidden && model.access !== "needs_enablement" && isChatUsableModelId(model.id);
}

/** Null when the vendor lists no chat models, so there is nothing to judge yet. */
export function deriveKeyHealth(models: CatalogModel[]): KeyHealth | null {
  const list = models.filter(relevant);
  if (list.length === 0) return null;

  const working = list.filter(m => m.verification === "verified").length;
  const failedModels = list.filter(m => m.verification === "failed");
  const unchecked = list.length - working - failedModels.length;
  const checked = list.map(m => m.checkedAt).filter((value): value is string => Boolean(value)).sort();
  const base = { working, failed: failedModels.length, unchecked, checkedAt: checked[checked.length - 1] };

  if (working > 0) {
    const problem = failedModels.length > 0 ? ` ${failedModels.length} did not, which is normal when a plan lacks some models.` : "";
    return {
      ...base,
      state: "working",
      label: "Working",
      detail: `${working} of ${list.length} models answered a test.${problem}`,
    };
  }

  if (failedModels.length > 0) {
    const codes = new Set(failedModels.map(m => m.verificationCode));
    if (codes.has("quota_or_billing")) {
      return {
        ...base,
        state: "no_quota",
        label: "Out of credit",
        detail: "The provider says this account has no usable quota or billing. Add credit or fix billing with the provider, then re-check.",
      };
    }
    if (codes.has("access_denied")) {
      return {
        ...base,
        state: "rejected",
        label: "Key rejected",
        detail: "The provider refused this key. It may be wrong, expired or revoked. Replace it, then re-check.",
      };
    }
    if (codes.has("throttled")) {
      return {
        ...base,
        state: "rate_limited",
        label: "Rate limited",
        detail: "The provider's rate or usage limit was reached. Wait a little, then re-check.",
      };
    }
    return {
      ...base,
      state: "failing",
      label: "Checks failing",
      detail: "No model answered a test. Open Review models to see the reason for each.",
    };
  }

  return {
    ...base,
    state: "unchecked",
    label: "Not checked yet",
    detail: "The key is saved, but no model has been tested with it. Run Check access.",
  };
}

/** "just now", "5 minutes ago", "3 days ago". */
export function relativeTime(iso: string | undefined, now = Date.now()): string | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return null;
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
