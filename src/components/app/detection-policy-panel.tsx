"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  SENSITIVITY_TIER_LABELS,
  SENSITIVITY_TIERS,
  categoriesAddedAtTier,
  categoriesForTier,
  isShippedDefaultSafeTerm,
  piiPatternCatalog,
  type PiiSensitivityTier,
  type SafeTerm,
} from "@/lib/pii";

export const DETECTION_FORWARD_ONLY_COPY =
  "Changing the tier does not re-scan or rewrite existing chat, Knowledge, or Insights history. Already-stored text stays as it is — including values that were never redacted. The new policy applies only to new chat sends and new Knowledge ingest. Already-redacted values cannot be restored.";

function categoryActiveAt(minTier: PiiSensitivityTier, column: PiiSensitivityTier): boolean {
  return SENSITIVITY_TIERS.indexOf(minTier) <= SENSITIVITY_TIERS.indexOf(column);
}

export function DetectionForwardOnlyNotice() {
  return (
    <p className="text-[0.7rem] leading-relaxed rounded-lg border border-amber-500/25 bg-amber-500/10 text-amber-100/80 px-3 py-2">
      {DETECTION_FORWARD_ONLY_COPY}
    </p>
  );
}

export function DetectionPolicyMatrix({
  currentTier,
  selectable = false,
  onSelectTier,
}: {
  currentTier: PiiSensitivityTier;
  selectable?: boolean;
  onSelectTier?: (tier: PiiSensitivityTier) => void;
}) {
  const catalog = piiPatternCatalog();

  return (
    <div className="overflow-x-auto rounded-xl border border-foreground/[0.07]">
      <table className="w-full min-w-[32rem] text-left text-[0.7rem]">
        <caption className="sr-only">
          Detection categories included at each sensitivity tier. Tiers are cumulative.
        </caption>
        <thead>
          <tr className="border-b border-foreground/10 bg-foreground/[0.03]">
            <th className="px-3 py-2 font-medium text-foreground/55">Category</th>
            {SENSITIVITY_TIERS.map(tier => {
              const selected = currentTier === tier;
              const added = categoriesAddedAtTier(tier);
              const inner = (
                <>
                  <span className="block font-semibold text-foreground/80">
                    {SENSITIVITY_TIER_LABELS[tier]}
                  </span>
                  <span className="block mt-0.5 text-[0.58rem] font-normal text-foreground/35 leading-snug">
                    {added.length > 0
                      ? `Adds ${added.join(", ").toLowerCase()}`
                      : "Same as previous tier"}
                    {tier === "balanced" ? " · Recommended" : ""}
                    {tier === "high" ? ". Expect more false positives" : ""}
                  </span>
                </>
              );
              return (
                <th
                  key={tier}
                  className={cn(
                    "px-2 py-2 font-medium w-[18%] align-bottom",
                    selected && "bg-indigo-500/[0.12]",
                  )}
                >
                  {selectable && onSelectTier ? (
                    <button
                      type="button"
                      onClick={() => onSelectTier(tier)}
                      aria-pressed={selected}
                      className="w-full text-left cursor-pointer rounded-md px-1 py-0.5 hover:bg-foreground/[0.04]"
                    >
                      {inner}
                    </button>
                  ) : (
                    inner
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {catalog.map(row => (
            <tr key={row.category} className="border-b border-foreground/[0.05] last:border-0">
              <th className="px-3 py-1.5 font-medium text-foreground/70">
                {row.label}
                {!row.exemptible && (
                  <span className="ml-1.5 text-[0.55rem] uppercase tracking-wide text-foreground/30">
                    never exempt
                  </span>
                )}
              </th>
              {SENSITIVITY_TIERS.map(tier => {
                const on = categoryActiveAt(row.minTier, tier);
                return (
                  <td
                    key={tier}
                    className={cn(
                      "px-2 py-1.5 text-center",
                      currentTier === tier && "bg-indigo-500/[0.08]",
                    )}
                  >
                    {on ? (
                      <Check
                        className="inline-block size-3.5 text-indigo-300/90"
                        aria-label="Included"
                      />
                    ) : (
                      <span className="text-foreground/20" aria-label="Not included">
                        —
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DetectionPolicyExplainer({
  currentTier,
  safeTermCount,
  safeTerms,
}: {
  currentTier: PiiSensitivityTier;
  safeTermCount?: number;
  safeTerms?: SafeTerm[];
}) {
  const active = categoriesForTier(currentTier);
  const addedHere = categoriesAddedAtTier(currentTier);
  const docMail = (safeTerms ?? []).filter(
    t => t.kind === "domain" && isShippedDefaultSafeTerm(t),
  );
  return (
    <div className="space-y-2 text-[0.68rem] text-foreground/45 leading-relaxed">
      <p>
        <span className="font-medium text-foreground/65 capitalize">{currentTier}</span>
        {" currently detects: "}
        {active.join(", ").toLowerCase()}.
        {addedHere.length === 0
          ? " This tier does not add families beyond the previous one."
          : null}
      </p>
      <p>
        Email addresses are on at every tier, including Low. Safe terms are exemptions
        matched <em>before</em> detection — they can skip a value even while that category
        stays listed as on. They are not the same as “off at this tier.”
        {typeof safeTermCount === "number"
          ? ` ${safeTermCount} exemption${safeTermCount === 1 ? "" : "s"} currently active.`
          : null}
      </p>
      {docMail.length > 0 && (
        <p>
          <span className="font-medium text-foreground/65">Shipped documentation mail</span>
          {" is exempt so "}
          <code className="font-mono text-foreground/55">@example.com</code>
          {", "}
          <code className="font-mono text-foreground/55">.test</code>
          {", and other reserved names are not treated as real people: "}
          {docMail.map(t => t.value).join(", ")}.
          {" Listed under Safe terms — remove any of them to detect those values."}
        </p>
      )}
    </div>
  );
}
