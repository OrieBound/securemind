import { routeMessageSync, scoreMessageComplexity } from "../src/lib/models/route-message";

const history = [
  { role: "user" as const, content: "What do you think about people who ghost their friends?" },
  { role: "assistant" as const, content: "Ghosting is like a system crash without a log file..." },
];

for (const m of ["Hello again", "How is your day going?"]) {
  const r = routeMessageSync({ message: m, history, lastTier: "Plus" });
  console.log(m, "→", r.tier, r.reason);
}

const r2 = routeMessageSync({ message: "How is your day going?", history: [
  { role: "user", content: "Hello again" },
  { role: "assistant", content: "Back to the conversation..." },
], lastTier: "High" });
console.log("after High hello:", r2.tier, r2.reason);
