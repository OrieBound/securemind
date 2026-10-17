/**
 * The score card: a record of why a turn landed on a tier.
 *
 * Every number on it comes from a named signal or adjustment, so "why Plus?" has a literal
 * answer. Metadata only: it never contains message text. Client-safe (types and formatting).
 */

export const SCORECARD_VERSION = 1;

export type RouteSignal = {
  id: string;
  /** Plain-language reason shown to the user. */
  label: string;
  /** Points added to (or taken from) the complexity score. */
  points: number;
};

export type RouteAdjustment = {
  id: "cap" | "carry-over" | "quality-floor" | "classifier" | "evidence-floor" | "turn-policy" | "not-applied";
  label: string;
  from: string;
  to: string;
};

export type RouteClassifierUse = {
  /** True when the small-model tie-break ran for this turn. */
  used: boolean;
  model?: string;
  tier?: string;
  promptTokens?: number;
  completionTokens?: number;
  /** Estimated USD for the tie-break call; folded into the turn's recorded cost. */
  costUsd?: number;
};

export type RouteScoreCard = {
  v: number;
  /** Starting score (the Standard baseline) before any signal. */
  baseline: number;
  signals: RouteSignal[];
  /** baseline + signal points, before caps, clamped 0-100. */
  rawScore: number;
  /** Score after any caps that apply (how-to and quick-fact). */
  score: number;
  /** Tier the score alone maps to. */
  scoreTier: string;
  adjustments: RouteAdjustment[];
  classifier: RouteClassifierUse;
  /** The tier that actually ran. */
  tier: string;
};

export function signalPointsTotal(card: Pick<RouteScoreCard, "signals">): number {
  return card.signals.reduce((sum, s) => sum + s.points, 0);
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

/** One line, e.g. `Plus: score 60 = 42 baseline +20 planning` plus any adjustments. */
export function scoreCardSummary(card: RouteScoreCard): string {
  const parts = card.signals.map(s => `${signed(s.points)} ${s.label}`);
  let line = `${card.tier}: score ${card.score} = ${card.baseline} baseline`;
  if (parts.length) line += ` ${parts.join(" ")}`;
  for (const a of card.adjustments) {
    line += `; ${a.label} (${a.from} to ${a.to})`;
  }
  return line;
}

/** Short reason string kept for telemetry and older callers. */
export function scoreCardReason(card: RouteScoreCard): string {
  const signalText = card.signals.map(s => s.id).join(", ");
  let reason = `score=${card.score} (${signalText || "baseline"})`;
  for (const a of card.adjustments) reason += `; ${a.id}:${a.from}->${a.to}`;
  if (card.classifier.used) reason += `; classifier->${card.classifier.tier ?? "?"}`;
  return reason;
}
