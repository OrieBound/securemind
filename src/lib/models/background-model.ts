/**
 * Picks a cheap vendor model for background work (memory facts, thread summaries) when neither the
 * fast Groq model nor a local model could do it. Only a model that has already answered a test in
 * this environment qualifies, and only the small, inexpensive families.
 */

import type { CatalogModel } from "./catalog-shared";

export type BackgroundVendorModel = {
  model: string;
  provider: "anthropic" | "openai" | "google" | "xai";
};

const PREFERENCE: Array<{ provider: BackgroundVendorModel["provider"]; family: RegExp }> = [
  { provider: "anthropic", family: /haiku/i },
  { provider: "openai", family: /nano|mini/i },
  { provider: "google", family: /flash-lite/i },
  { provider: "xai", family: /mini|fast/i },
];

function usable(m: CatalogModel): boolean {
  return (
    m.verification === "verified" &&
    !m.hidden &&
    m.access !== "needs_enablement" &&
    m.modality !== "other"
  );
}

export function pickBackgroundVendorModel(models: CatalogModel[]): BackgroundVendorModel | null {
  for (const { provider, family } of PREFERENCE) {
    const hit = models
      .filter(m => m.provider === provider && usable(m) && family.test(m.id))
      .sort((a, b) => b.id.localeCompare(a.id))[0];
    if (hit) return { model: hit.id, provider };
  }
  return null;
}
