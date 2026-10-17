/**
 * Message to complexity tier routing, with a score card that explains every decision.
 *
 * Phase 1 (this file, before retrieval), all deterministic and free:
 *   1. Acknowledgements and greetings are Micro.
 *   2. A table of named signals adds or subtracts points from a baseline of 42 (Standard).
 *   3. The score maps to a tier at fixed cutoffs.
 *   4. A short follow-up carries the last tier, one level lower per turn (decaying).
 *   5. Real conversation never runs on Micro.
 * Optional: when the score is genuinely ambiguous a small model breaks the tie, and its
 * cost is recorded on the card.
 *
 * Phase 2 (`applyEvidenceFloors`, after retrieval): a turn that answers from the user's
 * documents is never below Standard, and analysis across documents is at least Plus.
 *
 * Every number comes from a named signal or adjustment (see route-scorecard.ts). The tier
 * only chooses the model. Definitions of the tiers live in tier-definitions.ts.
 */

import { DEFAULT_ATTACHMENT_ASK } from "@/lib/attachments";
import { estimateInferenceCost } from "@/lib/pricing";
import { classifyComplexityLlm } from "./groq";
import { DEFAULT_TIER, TIER_NAMES, normalizeStoredTier } from "./router";
import {
  SCORECARD_VERSION,
  scoreCardReason,
  type RouteAdjustment,
  type RouteClassifierUse,
  type RouteScoreCard,
  type RouteSignal,
} from "./route-scorecard";
import { maxTier, stepDown, tierRank } from "./tier-definitions";

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
  /** Compact reason for telemetry. The score card is the full explanation. */
  reason: string;
  wasAuto: boolean;
  isTrivial: boolean;
  score?: number;
  /** Ids of the signals that fired. */
  signals?: string[];
  card: RouteScoreCard;
};

const VALID_TIERS = new Set<string>(TIER_NAMES);

export const BASELINE_SCORE = 42;

/** A follow-up this short can inherit the previous tier. */
const CARRY_MAX_CHARS = 160;

/** Signals after which a message is a fresh, self-contained ask: no carry-over. */
const NO_CARRY_SIGNALS = new Set(["casual-chat", "emotional", "greeting-again", "quick-fact", "how-to", "ack"]);

/** Signals that state intent clearly enough that a tie-break would add nothing. */
const CLEAR_INTENT_SIGNALS = new Set([
  "casual-chat", "emotional", "greeting-again", "quick-fact", "how-to",
  "planning", "compare-options", "decision-advice", "technical", "code-present",
  "deep-analysis", "creative", "attachment-no-instruction", "multi-part",
]);

// ── Phase 1a: trivial messages ──────────────────────────────────────────────

const GREETING_FILLER = "there|sir|ma'?am|team|everyone|everybody|folks|all|friend|buddy";

/** True one-liners: skip scoring and the classifier, always Micro. */
export function isTrivialMessage(message: string, hasImages = false): boolean {
  if (hasImages) return false;
  const m = message.trim();
  if (!m) return false;

  if (/^(thanks|thank you|thx|ok|okay|k|got it|cool|yes|no|sure|lol|haha|yep|nice|bye|nm|np)(\s+(thanks|ok|okay|cool|nice|sure))*\b[!?.]*$/i.test(m)) {
    return true;
  }
  // A greeting plus at most two filler words ("hello there sir"). Anything else ("hey there
  // how are you", "hello again") is real conversation and is scored.
  if (
    m.length <= 48 &&
    new RegExp(
      `^(hey|hi|hello|howdy|good\\s+(morning|afternoon|evening))\\b([\\s,]+(${GREETING_FILLER})){0,2}\\s*[!?.]*$`,
      "i",
    ).test(m)
  ) {
    return true;
  }
  return false;
}

// ── Phase 1b: signals ───────────────────────────────────────────────────────

type SignalContext = { message: string; lower: string; len: number };

type SignalRule = {
  id: string;
  label: string;
  /** Points to add, or 0/undefined when the rule does not apply. */
  points: (c: SignalContext) => number | undefined;
};

/** Real code, not ordinary punctuation: a fence, an arrow, a keyword with an identifier, a call followed by ; or {, or several braces. */
export function looksLikeCode(message: string): boolean {
  if (message.includes("```")) return true;
  if (/=>/.test(message)) return true;
  if (/\b(function|async|await|const|let|import|export|return)\s+[A-Za-z_$({]/.test(message)) return true;
  if (/\w\s*\([^)\n]*\)\s*[;{]/.test(message)) return true;
  return (message.match(/[{};]/g) ?? []).length >= 2;
}

const HOW_TO_RE = /^(how do i|how to|what is|what's an? |explain |give me an example|can you explain)/i;
const QUICK_FACT_RE = /\b(when was|who is|who was|who invented|who created|capital of|how many|what year|define )\b/i;

function isHowTo(c: SignalContext): boolean {
  return HOW_TO_RE.test(c.lower) && c.len >= 45 && c.len < 320;
}

function isQuickFact(c: SignalContext): boolean {
  return QUICK_FACT_RE.test(c.lower) && c.len < 120 && !/\b(think|feel|opinion)\b/i.test(c.lower);
}

/** Evaluated in order. Points are added to the baseline; the table is the whole scoring rule. */
export const SIGNAL_RULES: SignalRule[] = [
  { id: "very-short", label: "very short message", points: c => (c.len <= 20 ? -18 : undefined) },
  { id: "short", label: "short message", points: c => (c.len > 20 && c.len <= 50 ? -8 : undefined) },
  { id: "medium-length", label: "medium-length message", points: c => (c.len > 50 && c.len <= 120 ? -2 : undefined) },
  { id: "long", label: "long message", points: c => (c.len > 280 && c.len <= 450 ? 8 : undefined) },
  { id: "very-long", label: "very long message", points: c => (c.len > 450 ? 14 : undefined) },
  {
    id: "deep-analysis",
    label: "asks for a full system design or formal analysis",
    points: c =>
      /\b(design a (full|complete)|multi-tenant auth|formal proof|analyze thoroughly|comprehensive architecture)\b/i.test(c.lower)
        ? 45
        : undefined,
  },
  {
    id: "technical",
    label: "technical work: debugging, architecture, root cause",
    points: c =>
      c.len > 40 &&
      /\b(debug|refactor|implement|architecture|stack trace|race condition|code review|root cause|memory leak)\b/i.test(c.lower)
        ? 28
        : undefined,
  },
  { id: "code-present", label: "contains code", points: c => (c.len > 30 && looksLikeCode(c.message) ? 32 : undefined) },
  {
    id: "planning",
    label: "asks to plan or weigh options",
    points: c =>
      /\b(help me plan|best approach|think through|walk me through|pros and cons|strategy|roadmap|brainstorm|weigh (the )?options)\b/i.test(c.lower)
        ? 20
        : undefined,
  },
  {
    id: "compare-options",
    label: "compares options or trade-offs",
    points: c => (/\b(compare|evaluate).{0,40}(options|approaches|trade-?offs|paths)\b/i.test(c.lower) ? 16 : undefined),
  },
  {
    id: "decision-advice",
    label: "asks for decision advice",
    points: c =>
      c.len > 55 && /\b(what should i|how should i|advice on|help me decide)\b/i.test(c.lower) ? 14 : undefined,
  },
  {
    id: "multi-part",
    label: "several questions or steps in one message",
    points: c =>
      c.len > 60 && ((c.message.match(/\?/g) ?? []).length >= 2 || (c.message.match(/^\s*(\d+[.)]|[-*])\s/gm) ?? []).length >= 2)
        ? 8
        : undefined,
  },
  { id: "how-to", label: "simple how-to or explanation (capped at Light)", points: c => (isHowTo(c) ? 0 : undefined) },
  { id: "quick-fact", label: "single-fact question", points: c => (isQuickFact(c) ? -22 : undefined) },
  {
    id: "ack",
    label: "acknowledgement",
    points: c => (/^(thanks|thank you|ok|okay|got it|cool|yes|no|sure|lol|haha|yep|nice|bye)\b/i.test(c.lower) && c.len < 60 ? -35 : undefined),
  },
  {
    id: "emotional",
    label: "personal or emotional topic",
    points: c => (/\b(feel|feeling|lonely|anxious|stressed|excited|sad|happy|miss you|love|hate|worried)\b/i.test(c.lower) ? 4 : undefined),
  },
  {
    id: "casual-chat",
    label: "casual conversation",
    points: c =>
      c.len < 220 &&
      /\b(how are you|how is your day|how's your day|what's up|how's it going|tell me about|what do you think|your opinion)\b/i.test(c.lower)
        ? 8
        : undefined,
  },
  {
    id: "creative",
    label: "creative or open-ended writing",
    points: c => (c.len > 50 && /\b(write me|story|poem|creative|imagine|roleplay|what if)\b/i.test(c.lower) ? 10 : undefined),
  },
  {
    id: "attachment-no-instruction",
    label: "file attached with no instruction (read it carefully)",
    points: c => (c.message.trim() === DEFAULT_ATTACHMENT_ASK ? 8 : undefined),
  },
];

/** A returning-conversation greeting is kept on Standard even though it is short. */
const GREETING_AGAIN_RE = /\b(hello again|hi again|hey again|good morning|good evening|good afternoon)\b/i;

const HOW_TO_CAP = 28;
const QUICK_FACT_CAP = 18;
const GREETING_AGAIN_FLOOR = 40;

/** Map 0-100 score to tier. Cutoffs checked by the fixtures in route-fixtures.ts. */
export function tierFromScore(score: number): string {
  if (score >= 66) return "Max";
  if (score >= 52) return "Plus";
  if (score >= 36) return "Standard";
  if (score >= 12) return "Light";
  return "Micro";
}

function clampScore(n: number): number {
  return Math.max(0, Math.min(100, n));
}

function emptyClassifier(): RouteClassifierUse {
  return { used: false };
}

function cardOf(parts: {
  signals: RouteSignal[];
  rawScore: number;
  score: number;
  scoreTier: string;
  tier: string;
  adjustments?: RouteAdjustment[];
  classifier?: RouteClassifierUse;
}): RouteScoreCard {
  return {
    v: SCORECARD_VERSION,
    baseline: BASELINE_SCORE,
    signals: parts.signals,
    rawScore: parts.rawScore,
    score: parts.score,
    scoreTier: parts.scoreTier,
    adjustments: parts.adjustments ?? [],
    classifier: parts.classifier ?? emptyClassifier(),
    tier: parts.tier,
  };
}

/** Score a message: the signals that fired, the capped score, and the tier it maps to. */
export function scoreMessage(message: string): {
  signals: RouteSignal[];
  rawScore: number;
  score: number;
  caps: RouteAdjustment[];
} {
  const m = message.trim();
  const ctx: SignalContext = { message: m, lower: m.toLowerCase(), len: m.length };
  const signals: RouteSignal[] = [];
  let score = BASELINE_SCORE;
  for (const rule of SIGNAL_RULES) {
    const points = rule.points(ctx);
    if (points === undefined) continue;
    signals.push({ id: rule.id, label: rule.label, points });
    score += points;
  }
  if (GREETING_AGAIN_RE.test(ctx.lower) && score < GREETING_AGAIN_FLOOR) {
    const points = GREETING_AGAIN_FLOOR - score;
    signals.push({ id: "greeting-again", label: "greeting in an ongoing conversation", points });
    score += points;
  }
  const rawScore = clampScore(score);

  const caps: RouteAdjustment[] = [];
  let capped = rawScore;
  const has = (id: string) => signals.some(s => s.id === id);
  if (has("how-to") && capped > HOW_TO_CAP) {
    caps.push({ id: "cap", label: "how-to questions run on Light", from: tierFromScore(capped), to: tierFromScore(HOW_TO_CAP) });
    capped = HOW_TO_CAP;
  }
  if (has("quick-fact") && capped > QUICK_FACT_CAP) {
    caps.push({ id: "cap", label: "single-fact questions run on Light", from: tierFromScore(capped), to: tierFromScore(QUICK_FACT_CAP) });
    capped = QUICK_FACT_CAP;
  }
  return { signals, rawScore, score: capped, caps };
}

/** Back-compat for eval scripts: the score and the ids of the signals that fired. */
export function scoreMessageComplexity(message: string): { score: number; reasons: string[] } {
  const r = scoreMessage(message);
  return { score: r.score, reasons: ["baseline", ...r.signals.map(s => s.id)] };
}

/**
 * Carry-over: a short follow-up inherits the previous tier minus one level, so a thread
 * does not stay on an expensive tier forever. Only Plus and Max carry, and the carried
 * tier never drops below Standard.
 */
export function carryOverTier(
  tier: string,
  message: string,
  lastTier: string | null | undefined,
  signalIds: string[],
): { tier: string; adjustment?: RouteAdjustment } {
  if (!lastTier) return { tier };
  if (message.trim().length >= CARRY_MAX_CHARS) return { tier };
  if (signalIds.some(id => NO_CARRY_SIGNALS.has(id))) return { tier };
  const last = VALID_TIERS.has(lastTier) ? lastTier : normalizeStoredTier(lastTier);
  if (tierRank(last) < tierRank("Plus")) return { tier };
  const carried = stepDown(last, 1, "Standard");
  const next = maxTier(tier, carried);
  if (next === tier) return { tier };
  return {
    tier: next,
    adjustment: {
      id: "carry-over",
      label: `short follow-up to a ${last} reply (one level lower each turn)`,
      from: tier,
      to: next,
    },
  };
}

/** Quality floor: real conversation never runs on Micro. */
function applyQualityFloor(tier: string, signalIds: string[]): { tier: string; adjustment?: RouteAdjustment } {
  if (tier !== "Micro") return { tier };
  const next = signalIds.includes("quick-fact") || signalIds.includes("how-to") ? "Light" : "Standard";
  return {
    tier: next,
    adjustment: { id: "quality-floor", label: "real conversation does not run on Micro", from: "Micro", to: next },
  };
}

function finalize(
  base: { signals: RouteSignal[]; rawScore: number; score: number; caps: RouteAdjustment[] },
  startTier: string,
  message: string,
  lastTier: string | null | undefined,
  extraAdjustments: RouteAdjustment[] = [],
  classifier: RouteClassifierUse = emptyClassifier(),
): RouteScoreCard {
  const ids = base.signals.map(s => s.id);
  const adjustments: RouteAdjustment[] = [...base.caps, ...extraAdjustments];
  let tier = startTier;

  const carried = carryOverTier(tier, message, lastTier, ids);
  tier = carried.tier;
  if (carried.adjustment) adjustments.push(carried.adjustment);

  const floored = applyQualityFloor(tier, ids);
  tier = floored.tier;
  if (floored.adjustment) adjustments.push(floored.adjustment);

  if (!VALID_TIERS.has(tier)) tier = DEFAULT_TIER;
  return cardOf({
    signals: base.signals,
    rawScore: base.rawScore,
    score: base.score,
    scoreTier: tierFromScore(base.score),
    tier,
    adjustments,
    classifier,
  });
}

function resultFrom(card: RouteScoreCard, wasAuto: boolean, isTrivial: boolean): RouteResult {
  return {
    tier: card.tier,
    reason: scoreCardReason(card),
    wasAuto,
    isTrivial,
    score: card.score,
    signals: card.signals.map(s => s.id),
    card,
  };
}

/** Sync routing: signals, score, carry-over and quality floor. No network. */
export function routeMessageSync(input: RouteInput): RouteResult {
  const { message, lastTier, fallback = DEFAULT_TIER, hasImages = false } = input;
  const m = message.trim();
  if (!m) {
    const tier = VALID_TIERS.has(fallback) ? fallback : DEFAULT_TIER;
    const card = cardOf({ signals: [], rawScore: BASELINE_SCORE, score: BASELINE_SCORE, scoreTier: tierFromScore(BASELINE_SCORE), tier });
    return { ...resultFrom(card, false, false), reason: "empty" };
  }

  if (isTrivialMessage(m, hasImages)) {
    const card = cardOf({
      signals: [{ id: "trivial", label: "acknowledgement or greeting only", points: -BASELINE_SCORE }],
      rawScore: 0,
      score: 0,
      scoreTier: "Micro",
      tier: "Micro",
    });
    return resultFrom(card, true, true);
  }

  const base = scoreMessage(m);
  const card = finalize(base, tierFromScore(base.score), m, lastTier);
  return resultFrom(card, true, false);
}

/** Borderline scores: a tie-break is worth it only when no signal states the intent. */
export function isAmbiguousScore(score: number, signalIds: string[] = []): boolean {
  if (signalIds.some(id => CLEAR_INTENT_SIGNALS.has(id))) return false;
  return score >= 34 && score <= 46;
}

/**
 * Full routing: sync first; a small-model tie-break only when the score is ambiguous and a
 * cheap model is available. The tie-break's cost is returned on the card so the caller can
 * add it to the turn's recorded cost.
 */
export async function routeMessage(input: RouteInput): Promise<RouteResult> {
  const sync = routeMessageSync(input);
  if (sync.isTrivial || !isAmbiguousScore(sync.score ?? BASELINE_SCORE, sync.signals ?? [])) {
    return sync;
  }

  const { message, history = [], fallback = DEFAULT_TIER, lastTier } = input;
  const classified = await classifyComplexityLlm(message, fallback, history.slice(-4));
  const usage = classified.usage;

  // Price the call whenever it ran, even if its answer was unusable: the tokens were spent.
  const classifier: RouteClassifierUse = {
    used: classified.wasAuto || Boolean(usage),
    model: classified.model,
    tier: classified.wasAuto ? classified.mode : undefined,
  };
  if (usage && classified.model) {
    const est = estimateInferenceCost({
      provider: "groq",
      model: classified.model,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
    });
    classifier.promptTokens = usage.promptTokens;
    classifier.completionTokens = usage.completionTokens;
    classifier.costUsd = est.estimatedCostUsd ?? undefined;
  }

  // No cheap model available, or it gave no usable answer: the rules' tier stands.
  if (!classified.wasAuto) {
    if (!classifier.used) return sync;
    return resultFrom({ ...sync.card, classifier }, true, false);
  }

  const base = scoreMessage(message);
  const adjustments: RouteAdjustment[] = [];
  let tier = classified.mode;
  if (tier === "Micro") {
    tier = "Standard";
    adjustments.push({ id: "classifier", label: "tie-break said Micro; real conversation runs on Standard", from: "Micro", to: "Standard" });
  }
  if (tier !== sync.card.scoreTier) {
    adjustments.unshift({
      id: "classifier",
      label: "small model broke a tie the score could not",
      from: sync.card.scoreTier,
      to: tier,
    });
  }

  const card = finalize(base, tier, message, lastTier, adjustments, classifier);
  return resultFrom(card, true, false);
}

// ── Phase 2: evidence-aware floors ──────────────────────────────────────────

export type EvidenceFloorContext = {
  message: string;
  /** Passages that will actually be placed in the prompt. */
  evidencePassages: number;
  evidenceDocuments: number;
  /** Characters of file text attached to this turn. */
  attachmentChars: number;
};

const ANALYTIC_ASK_RE =
  /\b(summari[sz]e|summary|analy[sz]e|analysis|compare|contrast|risks?|review|audit|differences?|discrepanc(?:y|ies)|inconsisten\w*|evaluate|assess)\b/i;

/**
 * After retrieval, raise (never lower) the tier when the answer must be read from the
 * user's documents. A short question about a document is still a document question, and
 * the cheap model that was right for the words alone is not right for reading evidence.
 */
export function applyEvidenceFloors(card: RouteScoreCard, ctx: EvidenceFloorContext): RouteScoreCard {
  const fromDocuments = ctx.evidencePassages > 0 || ctx.attachmentChars > 0;
  if (!fromDocuments) return card;

  let floor = "Standard";
  let label = "answers from your documents need a careful reader";
  // The canned "Please review the attached file(s)." says nothing about wanting analysis.
  const asksForAnalysis =
    ctx.message.trim() !== DEFAULT_ATTACHMENT_ASK && ANALYTIC_ASK_RE.test(ctx.message);
  if (asksForAnalysis) {
    floor = "Plus";
    label = "summary or analysis of your documents";
  }
  if (ctx.evidenceDocuments >= 3 && tierRank(floor) < tierRank("Plus")) {
    floor = "Plus";
    label = "draws on three or more documents";
  }
  if (tierRank(floor) <= tierRank(card.tier)) return card;

  return {
    ...card,
    tier: floor,
    adjustments: [...card.adjustments, { id: "evidence-floor", label, from: card.tier, to: floor }],
  };
}

/** Record that turn policy forced Micro (social, help, clarification). */
export function applyTurnPolicyMicro(card: RouteScoreCard): RouteScoreCard {
  if (card.tier === "Micro") return card;
  return {
    ...card,
    tier: "Micro",
    adjustments: [
      ...card.adjustments,
      { id: "turn-policy", label: "social, help or clarification turn runs on Micro", from: card.tier, to: "Micro" },
    ],
  };
}

/** A floor was due but no usable model exists at that tier (or it would breach the cost cap). */
export function noteFloorNotApplied(card: RouteScoreCard, wanted: string, why: string): RouteScoreCard {
  return {
    ...card,
    adjustments: [
      ...card.adjustments,
      { id: "not-applied", label: `${wanted} was wanted but not used: ${why}`, from: card.tier, to: card.tier },
    ],
  };
}
