/**
 * Route distribution eval — run: npx tsx scripts/route-eval.ts
 *
 * Validates tier picks across conversation styles without hitting Groq chat APIs.
 */

import {
  routeMessageSync,
  scoreMessageComplexity,
  tierFromScore,
  type RouteHistoryMessage,
} from "../src/lib/models/route-message";

type Fixture = {
  id: string;
  message: string;
  expect: string;
  history?: RouteHistoryMessage[];
  lastTier?: string;
};

const FIXTURES: Fixture[] = [
  // Micro — acks
  { id: "ack-thanks", message: "thanks!", expect: "Micro" },
  { id: "ack-ok", message: "ok cool", expect: "Micro" },
  { id: "ack-lol", message: "lol", expect: "Micro" },
  { id: "ack-hi", message: "hey", expect: "Micro" },
  { id: "ack-hi-long", message: "hey there how are you", expect: "Standard" },

  // Fast — facts
  { id: "fact-who", message: "who invented the telephone?", expect: "Fast" },
  { id: "fact-capital", message: "capital of France", expect: "Fast" },
  { id: "fact-when", message: "when was the moon landing", expect: "Fast" },

  // Light — how-to
  { id: "howto-egg", message: "how do I boil an egg properly without cracking it", expect: "Light" },
  { id: "howto-rest", message: "what is a REST API — explain in simple terms please", expect: "Light" },

  // Standard — companion chat
  { id: "chat-day", message: "how's your day going?", expect: "Standard" },
  { id: "chat-hello-again", message: "Hello again", expect: "Standard" },
  { id: "chat-day-is", message: "How is your day going?", expect: "Standard" },
  { id: "chat-feel", message: "I've been feeling kind of down lately, nothing specific", expect: "Standard" },
  { id: "chat-opinion", message: "what do you think about people who ghost their friends", expect: "Standard" },
  { id: "chat-fun", message: "tell me something random that made you smile recently", expect: "Standard" },
  { id: "chat-short", message: "that's wild honestly", expect: "Light" },

  // Plus — planning / advice
  { id: "plan-job", message: "help me think through whether I should quit my job this year", expect: "Plus" },
  { id: "plan-learn", message: "what's the best approach for learning Spanish in six months", expect: "Plus" },
  { id: "plan-pros", message: "pros and cons of renting vs buying in this market", expect: "Plus" },
  { id: "plan-decide", message: "how should I decide between two job offers with very different cultures", expect: "Plus" },

  // High — technical
  {
    id: "tech-debug",
    message: "why does this async function hang forever when I await fetch inside useEffect?",
    expect: "High",
  },
  {
    id: "tech-code",
    message: "```js\nuseEffect(() => {\n  fetch('/api').then(r => setData(r));\n}, []);\n```\nwhat's wrong here?",
    expect: "High",
  },
  {
    id: "tech-arch",
    message: "help me debug this race condition in my Prisma transaction code",
    expect: "High",
  },

  // Max — deep
  {
    id: "max-design",
    message: "design a complete multi-tenant auth system with SSO, row-level security, and audit logs",
    expect: "Max",
  },

  // Thread stickiness
  {
    id: "stick-tech",
    message: "what about Redis?",
    expect: "High",
    history: [
      { role: "user", content: "my API keeps timing out under load" },
      { role: "assistant", content: "sounds like you need caching or a queue" },
    ],
    lastTier: "High",
  },
  {
    id: "stick-plan",
    message: "and the budget angle?",
    expect: "Plus",
    history: [
      { role: "user", content: "help me plan a move to another city next year" },
      { role: "assistant", content: "let's break down timeline and costs" },
    ],
    lastTier: "Plus",
  },
];

function runEval() {
  let pass = 0;
  let fail = 0;
  const distribution: Record<string, number> = {};
  const failures: string[] = [];

  console.log("\n── Route eval (sync scoring) ──\n");

  for (const f of FIXTURES) {
    const result = routeMessageSync({
      message: f.message,
      history: f.history,
      lastTier: f.lastTier,
    });
    const { score } = scoreMessageComplexity(f.message, f.history ?? []);
    distribution[result.tier] = (distribution[result.tier] ?? 0) + 1;

    const ok = result.tier === f.expect;
    if (ok) {
      pass++;
      console.log(`  ✓ ${f.id.padEnd(16)} → ${result.tier.padEnd(8)} (score ${score})`);
    } else {
      fail++;
      failures.push(f.id);
      console.log(`  ✗ ${f.id.padEnd(16)} → ${result.tier.padEnd(8)} expected ${f.expect} (score ${score})`);
      console.log(`      ${result.reason}`);
    }
  }

  console.log("\n── Tier distribution ──\n");
  for (const tier of ["Micro", "Fast", "Light", "Standard", "Plus", "High", "Max"]) {
    const n = distribution[tier] ?? 0;
    const bar = "█".repeat(n);
    console.log(`  ${tier.padEnd(10)} ${String(n).padStart(2)} ${bar}`);
  }

  console.log(`\n── Result: ${pass}/${FIXTURES.length} passed ──\n`);

  if (fail > 0) {
    console.log(`Failed: ${failures.join(", ")}\n`);
    process.exit(1);
  }
}

/** Sweep score thresholds for tuning (dev only). */
function sweepThresholds() {
  console.log("Score → tier mapping samples:");
  for (const s of [0, 10, 14, 20, 26, 32, 38, 42, 48, 54, 60, 68, 75, 82, 90]) {
    console.log(`  score ${String(s).padStart(2)} → ${tierFromScore(s)}`);
  }
}

sweepThresholds();
runEval();
