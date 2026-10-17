/**
 * Route distribution eval. Run: npm run route-eval
 *
 * Runs every fixture in src/lib/models/route-fixtures.ts (the same set CI checks) through
 * both routing phases and prints the score card for any that miss. No model calls.
 */

import { ROUTE_FIXTURES, runFixture } from "../src/lib/models/route-fixtures";
import { scoreCardSummary } from "../src/lib/models/route-scorecard";
import { TIER_ORDER } from "../src/lib/models/tier-definitions";

function runEval() {
  let pass = 0;
  const distribution: Record<string, number> = {};
  const failures: string[] = [];

  console.log("\n-- Route eval --\n");
  for (const f of ROUTE_FIXTURES) {
    const card = runFixture(f);
    distribution[card.tier] = (distribution[card.tier] ?? 0) + 1;
    if (card.tier === f.expect) {
      pass++;
      console.log(`  ok   ${f.id.padEnd(26)} ${card.tier.padEnd(9)} score ${card.score}`);
    } else {
      failures.push(f.id);
      console.log(`  FAIL ${f.id.padEnd(26)} ${card.tier.padEnd(9)} expected ${f.expect}`);
      console.log(`       ${scoreCardSummary(card)}`);
    }
  }

  console.log("\n-- Tier distribution --\n");
  for (const tier of TIER_ORDER) {
    const n = distribution[tier] ?? 0;
    console.log(`  ${tier.padEnd(9)} ${String(n).padStart(2)} ${"#".repeat(n)}`);
  }
  console.log(`\n-- ${pass}/${ROUTE_FIXTURES.length} passed --\n`);
  if (failures.length) {
    console.log(`Failed: ${failures.join(", ")}\n`);
    process.exit(1);
  }
}

runEval();
