/**
 * What each complexity tier means, in one place.
 *
 * The router, the tie-break prompt, the Insights panel and the Settings tier editor all read
 * from here, so the explanation a user sees is the rule the code follows. Client-safe: no
 * server imports. Model assignment per tier lives in router.ts; this file is only meaning.
 */

export const TIER_ORDER = ["Micro", "Light", "Standard", "Plus", "Max"] as const;
export type TierName = (typeof TIER_ORDER)[number];

export type TierDefinition = {
  tier: TierName;
  /** One line a person can read: what kind of work lands here. */
  summary: string;
  /** Typical messages, for tooltips and the tie-break prompt. */
  examples: string[];
};

export const TIER_DEFINITIONS: Record<TierName, TierDefinition> = {
  Micro: {
    tier: "Micro",
    summary: "Acknowledgements and greetings only. No real question to answer.",
    examples: ["thanks", "ok", "hello there"],
  },
  Light: {
    tier: "Light",
    summary: "A single fact or a simple how-to that needs a short, direct answer.",
    examples: ["who invented the telephone?", "how do I boil an egg properly"],
  },
  Standard: {
    tier: "Standard",
    summary:
      "Everyday conversation, and questions answered from a few passages of your documents.",
    examples: ["how's your day going?", "what is the notice period in the agreement?"],
  },
  Plus: {
    tier: "Plus",
    summary:
      "Multi-step planning, comparing options, and summaries or analysis of your documents.",
    examples: ["pros and cons of renting vs buying", "summarize this contract and list the risks"],
  },
  Max: {
    tier: "Max",
    summary: "Code and debugging, formal reasoning, and designing whole systems.",
    examples: ["why does this async function hang?", "design a multi-tenant auth system"],
  },
};

export function tierRank(tier: string): number {
  const i = TIER_ORDER.indexOf(tier as TierName);
  return i === -1 ? TIER_ORDER.indexOf("Standard") : i;
}

export function maxTier(a: string, b: string): string {
  return tierRank(a) >= tierRank(b) ? a : b;
}

export function minTier(a: string, b: string): string {
  return tierRank(a) <= tierRank(b) ? a : b;
}

/** The tier `steps` levels below `tier`, never below `floor` (Micro by default). */
export function stepDown(tier: string, steps = 1, floor: string = "Micro"): string {
  const next = Math.max(tierRank(tier) - steps, tierRank(floor));
  return TIER_ORDER[next];
}

/** Plain-language text for the tie-break prompt, generated from the definitions above. */
export function tierGuideForPrompt(): string {
  return [...TIER_ORDER]
    .reverse()
    .map(t => `${t.padEnd(8)} - ${TIER_DEFINITIONS[t].summary}`)
    .join("\n");
}
