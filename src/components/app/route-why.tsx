"use client";

import { signalPointsTotal, type RouteScoreCard } from "@/lib/models/route-scorecard";
import { TIER_DEFINITIONS, type TierName } from "@/lib/models/tier-definitions";

function points(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

function usd(n: number): string {
  return n < 0.0001 ? "under $0.0001" : `$${n.toFixed(4)}`;
}

/**
 * "Why this tier?" for one reply: the signals and their points, then every adjustment
 * (cap, carry-over, floor, tie-break). Every line comes from the score card the server
 * recorded, so the explanation is the rule that ran. Metadata only; no message text.
 */
export function RouteWhy({ card, compact = false }: { card: RouteScoreCard; compact?: boolean }) {
  const definition = TIER_DEFINITIONS[card.tier as TierName];
  const total = signalPointsTotal(card);

  return (
    <details className="group text-meta" data-testid="route-why">
      <summary className="cursor-pointer select-none list-none text-[0.68rem] text-foreground/45 hover:text-foreground/70 transition-colors">
        <span className="underline decoration-dotted underline-offset-2">Why {card.tier}?</span>
      </summary>
      <div
        className={
          compact
            ? "mt-1.5 space-y-1.5 text-[0.68rem] leading-snug text-foreground/60"
            : "mt-2 space-y-1.5 rounded-lg border border-foreground/[0.07] bg-foreground/[0.02] px-3 py-2 text-[0.7rem] leading-snug text-foreground/65"
        }
      >
        {definition && (
          <p>
            <span className="font-medium text-foreground/80">{card.tier}</span>: {definition.summary}
          </p>
        )}

        {card.signals.length === 0 ? (
          <p>No signals fired, so the message scored the {card.baseline} baseline.</p>
        ) : (
          <ul className="space-y-0.5">
            <li className="flex justify-between gap-3 text-foreground/45">
              <span>Baseline</span>
              <span className="tabular-nums">{card.baseline}</span>
            </li>
            {card.signals.map(s => (
              <li key={s.id} className="flex justify-between gap-3">
                <span>{s.label}</span>
                <span className="tabular-nums font-mono">{points(s.points)}</span>
              </li>
            ))}
            <li className="flex justify-between gap-3 border-t border-foreground/10 pt-0.5 text-foreground/80">
              <span>Score ({card.baseline} {points(total)})</span>
              <span className="tabular-nums font-mono">{card.score}</span>
            </li>
          </ul>
        )}

        {card.adjustments.length > 0 && (
          <ul className="space-y-0.5">
            {card.adjustments.map((a, i) => (
              <li key={`${a.id}-${i}`}>
                {a.label}
                {a.from !== a.to && (
                  <span className="text-foreground/45">
                    {" "}({a.from} to {a.to})
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}

        {card.classifier.used && (
          <p className="text-foreground/50">
            A small model broke a tie
            {card.classifier.costUsd != null && <> (cost {usd(card.classifier.costUsd)}, included in this reply)</>}.
          </p>
        )}
      </div>
    </details>
  );
}
