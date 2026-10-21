/**
 * "Enable recommended Bedrock models": a short list of cheap, widely available chat models
 * to turn on with one click. Matched by family name against the live catalog, never by a
 * fixed model id: Bedrock retires versions, so the newest listed version of each family is
 * tried first and the next one is the fallback.
 */

import type { CatalogModel } from "./catalog-shared";

export const RECOMMENDED_BEDROCK_FAMILIES: readonly { label: string; matches: (id: string) => boolean }[] = [
  { label: "Amazon Nova Lite", matches: id => /nova-lite/i.test(id) },
  { label: "Claude Haiku", matches: id => /haiku/i.test(id) },
];

export type RecommendedFamilyPlan = {
  label: string;
  /** Newest first. Try in order and stop at the first that answers. */
  candidates: CatalogModel[];
};

const MAX_ATTEMPTS_PER_FAMILY = 3;

/**
 * Families that still need turning on, with the models to try for each.
 * Skips a family that already has a model in chat, and models the AWS account has not enabled
 * (those need the Bedrock console, which this app cannot do).
 */
export function planRecommendedBedrock(models: CatalogModel[]): RecommendedFamilyPlan[] {
  const bedrock = models.filter(m => m.provider === "bedrock" && m.modality !== "other");
  const plans: RecommendedFamilyPlan[] = [];
  for (const family of RECOMMENDED_BEDROCK_FAMILIES) {
    const members = bedrock.filter(m => family.matches(m.id));
    if (members.some(m => m.verification === "verified" && !m.hidden)) continue;
    const candidates = members
      .filter(m => !m.hidden && m.access !== "needs_enablement" && m.verification !== "failed")
      .sort((a, b) => b.id.localeCompare(a.id, "en", { numeric: true }))
      .slice(0, MAX_ATTEMPTS_PER_FAMILY);
    if (candidates.length > 0) plans.push({ label: family.label, candidates });
  }
  return plans;
}

/** Families the account lists but has not enabled, so the summary can point at the console. */
export function recommendedNeedingConsole(models: CatalogModel[]): string[] {
  const out: string[] = [];
  for (const family of RECOMMENDED_BEDROCK_FAMILIES) {
    const members = models.filter(m => m.provider === "bedrock" && family.matches(m.id));
    if (members.length === 0) continue;
    const usable = members.some(m => m.access !== "needs_enablement");
    if (!usable) out.push(family.label);
  }
  return out;
}
