/**
 * Message → complexity tier routing.
 *
 * Three passes (sync, no API):
 *   1. Trivial acks → Micro
 *   2. Intent scoring → tier
 *   3. Thread stickiness (short follow-ups inherit deep tiers)
 *
 * Optional async pass: LLM classifier when score is ambiguous (borderline band).
 */

import { classifyComplexityLlm } from "./groq";
import { DEFAULT_TIER, TIER_NAMES } from "./router";

export type RouteHistoryMessage = { role: "user" | "assistant"; content: string };

export type RouteInput = {
  message: string;
  history?: RouteHistoryMessage[];
  /** Tier used for the previous assistant turn in this session */
  lastTier?: string | null;
  fallback?: string;
  hasImages?: boolean;
};

export type RouteResult = {
  tier: string;
  reason: string;
  wasAuto: boolean;
  isTrivial: boolean;
  score?: number;
  signals?: string[];
};

const VALID_TIERS = new Set<string>(TIER_NAMES);

const TIER_ORDER = ["Micro", "Fast", "Light", "Standard", "Plus", "High", "Max"] as const;

function tierRank(tier: string): number {
  const i = TIER_ORDER.indexOf(tier as (typeof TIER_ORDER)[number]);
  return i === -1 ? TIER_ORDER.indexOf(DEFAULT_TIER) : i;
}

function maxTier(a: string, b: string): string {
  return tierRank(a) >= tierRank(b) ? a : b;
}

function minTier(a: string, b: string): string {
  return tierRank(a) <= tierRank(b) ? a : b;
}

/** True one-liners — skip classifier, always Micro. */
export function isTrivialMessage(message: string, hasImages = false): boolean {
  if (hasImages) return false;
  const m = message.trim();
  if (!m) return false;

  if (/^(thanks|thank you|thx|ok|okay|k|got it|cool|yes|no|sure|lol|haha|yep|nice|bye|nm|np)(\s+(thanks|ok|okay|cool|nice|sure))*\b[!?.]*$/i.test(m)) {
    return true;
  }
  if (/^(hey|hi|hello)\b[!?.]*$/i.test(m) && m.length <= 20) {
    return true;
  }
  return false;
}

type ScoreSignals = {
  score: number;
  reasons: string[];
};

/**
 * Complexity score 0–100 → mapped to tier.
 * Baseline ~42 (Standard). Lower = cheaper tier, higher = more capable.
 */
export function scoreMessageComplexity(
  message: string,
  history: RouteHistoryMessage[] = [],
): ScoreSignals {
  const m = message.trim();
  const lower = m.toLowerCase();
  const len = m.length;
  let score = 42;
  const reasons: string[] = ["baseline:Standard"];

  const recentText = history.slice(-2).map(h => h.content).join(" ").toLowerCase();
  const inDeepThread = /\b(debug|architect|implement|refactor|code|api|deploy|async|typescript|react|prisma)\b/.test(recentText);
  const inPlanningThread = /\b(plan|strategy|decide|options|approach|roadmap)\b/.test(recentText);

  // ── Length ──
  if (len <= 20) { score -= 18; reasons.push("very short"); }
  else if (len <= 50) { score -= 8; reasons.push("short"); }
  else if (len <= 120) { score -= 2; }
  else if (len > 280) { score += 8; reasons.push("long"); }
  else if (len > 450) { score += 14; reasons.push("very long"); }

  // ── Max / deep ──
  if (/\b(design a (full|complete)|multi-tenant auth|formal proof|analyze thoroughly|comprehensive architecture)\b/i.test(lower)) {
    score += 45; reasons.push("deep-analysis");
  }

  // ── High / technical ──
  if (/\b(debug|refactor|implement|architecture|stack trace|race condition|code review|root cause|memory leak)\b/i.test(lower) && len > 40) {
    score += 28; reasons.push("technical");
  }
  if (/(```|[{}();]|=>|function\s|async\s|await\s|const\s|import\s)/.test(m) && len > 30) {
    score += 32; reasons.push("code-present");
  }
  if (inDeepThread && len < 160) {
    score += 22; reasons.push("deep-thread-follow-up");
  }

  // ── Plus / planning ──
  if (/\b(help me plan|best approach|think through|walk me through|pros and cons|strategy|roadmap|brainstorm|weigh (the )?options)\b/i.test(lower)) {
    score += 20; reasons.push("planning");
  }
  if (/\b(compare|evaluate).{0,40}(options|approaches|trade-?offs|paths)\b/i.test(lower)) {
    score += 16; reasons.push("compare-options");
  }
  if (/\b(what should i|how should i|advice on|help me decide)\b/i.test(lower) && len > 55) {
    score += 14; reasons.push("decision-advice");
  }
  if (inPlanningThread && len < 180) {
    score += 12; reasons.push("planning-thread-follow-up");
  }

  // ── Light / how-to ──
  let isHowTo = false;
  if (/^(how do i|how to|what is|what's an? |explain |give me an example|can you explain)/i.test(lower) && len >= 45 && len < 320) {
    isHowTo = true;
    reasons.push("how-to-explain");
  }

  // ── Fast / facts ──
  let isQuickFact = false;
  if (/\b(when was|who is|who was|who invented|who created|capital of|how many|what year|define )\b/i.test(lower) && len < 120 && !/\b(think|feel|opinion)\b/i.test(lower)) {
    score -= 22;
    isQuickFact = true;
    reasons.push("quick-fact");
  }

  // ── Micro-ish acks (non-trivial path shouldn't hit, but score low) ──
  if (/^(thanks|thank you|ok|okay|got it|cool|yes|no|sure|lol|haha|yep|nice|bye)\b/i.test(lower) && len < 60) {
    score -= 35; reasons.push("ack");
  }

  // ── Standard companion chat (warm, emotional, opinion) ──
  if (/\b(feel|feeling|lonely|anxious|stressed|excited|sad|happy|miss you|love|hate|worried)\b/i.test(lower)) {
    score += 4; reasons.push("emotional");
  }
  if (/\b(how are you|how is your day|how's your day|what's up|how's it going|tell me about|what do you think|your opinion)\b/i.test(lower) && len < 220) {
    score += 8; reasons.push("casual-chat");
  }
  if (/\b(hello again|hi again|hey again|good morning|good evening|good afternoon)\b/i.test(lower)) {
    score = Math.max(score, 40);
    reasons.push("greeting");
  }

  // ── Creative / open-ended (slight bump toward Plus) ──
  if (/\b(write me|story|poem|creative|imagine|roleplay|what if)\b/i.test(lower) && len > 50) {
    score += 10; reasons.push("creative");
  }

  if (isHowTo) score = Math.min(score, 28);
  if (isQuickFact) score = Math.min(score, 18);

  return { score: Math.max(0, Math.min(100, score)), reasons };
}

/** Map 0–100 score → tier. Thresholds tuned via scripts/route-eval.mjs */
export function tierFromScore(score: number): string {
  if (score >= 80) return "Max";
  if (score >= 66) return "High";
  if (score >= 52) return "Plus";
  if (score >= 36) return "Standard";
  if (score >= 24) return "Light";
  if (score >= 12) return "Fast";
  return "Micro";
}

/** Short follow-ups inherit the active thread tier — never bump casual/greeting turns. */
export function applyThreadStickiness(
  tier: string,
  message: string,
  history: RouteHistoryMessage[],
  lastTier?: string | null,
  signals: string[] = [],
): { tier: string; reason?: string } {
  const noStickiness = ["casual-chat", "emotional", "greeting", "quick-fact", "how-to-explain"];
  if (signals.some(s => noStickiness.includes(s))) {
    return { tier };
  }

  const len = message.trim().length;
  const userRecent = history
    .slice(-4)
    .filter(h => h.role === "user")
    .map(h => h.content)
    .join(" ")
    .toLowerCase();

  const threadTier = lastTier && VALID_TIERS.has(lastTier) ? lastTier : null;
  const deepThread = /\b(debug|code|implement|architect|refactor|async|api|error|function)\b/.test(userRecent);
  const planThread = /\b(plan|strategy|decide|options|approach)\b/.test(userRecent);

  if (len < 160) {
    if (threadTier && tierRank(threadTier) >= tierRank("Plus")) {
      return { tier: maxTier(tier, minTier(threadTier, "High")), reason: `stickiness:last=${threadTier}` };
    }
    if (deepThread && tierRank(tier) < tierRank("High")) {
      return { tier: "High", reason: "stickiness:deep-thread" };
    }
    if (planThread && tierRank(tier) < tierRank("Plus")) {
      return { tier: "Plus", reason: "stickiness:planning-thread" };
    }
  }

  return { tier };
}

/** Sync routing — heuristics + score + stickiness + quality floor. */
export function routeMessageSync(input: RouteInput): RouteResult {
  const { message, history = [], lastTier, fallback = DEFAULT_TIER, hasImages = false } = input;
  const m = message.trim();
  if (!m) {
    return { tier: fallback, reason: "empty", wasAuto: false, isTrivial: false };
  }

  if (isTrivialMessage(m, hasImages)) {
    return { tier: "Micro", reason: "trivial-ack", wasAuto: true, isTrivial: true, score: 0, signals: ["trivial"] };
  }

  const { score, reasons } = scoreMessageComplexity(m, history);
  let tier = tierFromScore(score);
  let reason = `score=${score} (${reasons.join(", ")})`;

  const sticky = applyThreadStickiness(tier, m, history, lastTier, reasons);
  if (sticky.reason) {
    tier = sticky.tier;
    reason += `; ${sticky.reason}`;
  }

  // Quality floor — real conversation never uses Micro (preserve Fast/Light for facts/how-to)
  if (tier === "Micro") {
    if (reasons.includes("quick-fact")) tier = "Fast";
    else if (reasons.includes("how-to-explain")) tier = "Light";
    else tier = "Standard";
    reason += `; floor→${tier}`;
  }

  if (!VALID_TIERS.has(tier)) tier = fallback;

  return { tier, reason, wasAuto: true, isTrivial: false, score, signals: reasons };
}

/** Borderline scores — LLM tiebreaker only when intent is genuinely unclear. */
export function isAmbiguousScore(score: number, reasons: string[] = []): boolean {
  const clearIntent = [
    "casual-chat", "emotional", "greeting", "quick-fact", "how-to-explain",
    "planning", "compare-options", "decision-advice", "technical", "code-present",
    "deep-analysis", "creative",
  ];
  if (reasons.some(r => clearIntent.includes(r))) return false;
  return score >= 34 && score <= 46;
}

/** Full routing: sync first; classifier only when ambiguous and Groq available. */
export async function routeMessage(input: RouteInput): Promise<RouteResult> {
  const sync = routeMessageSync(input);
  if (sync.isTrivial || !isAmbiguousScore(sync.score ?? 42, sync.signals ?? [])) {
    return sync;
  }

  const { message, history = [], fallback = DEFAULT_TIER } = input;
  const classified = await classifyComplexityLlm(message, fallback, history.slice(-4));
  let tier = classified.mode;

  if (!sync.isTrivial && tier === "Micro") tier = "Standard";

  const sticky = applyThreadStickiness(tier, message, history, input.lastTier, sync.signals ?? []);
  if (sticky.reason) tier = sticky.tier;

  return {
    tier,
    reason: `ambiguous score=${sync.score}; classifier→${classified.mode}${sticky.reason ? `; ${sticky.reason}` : ""}`,
    wasAuto: true,
    isTrivial: false,
    score: sync.score,
  };
}

// Re-export for eval scripts
export { heuristicComplexityTier } from "./groq";
