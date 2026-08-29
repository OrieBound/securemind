#!/usr/bin/env node
/**
 * Pricing table freshness check (estimates only — does not auto-edit rates).
 *
 * What this does:
 *  1. Prints curated table versions from src/lib/pricing/*.ts
 *  2. Fetches Groq docs HTML and flags router models missing from the page text
 *  3. Reminds you to re-check Bedrock on-demand rates on the AWS pricing page
 *     (AWS Price List GetProducts is incomplete for many newer Bedrock models)
 *
 * Usage: npm run pricing:check
 * Exit 1 if a Groq production model id from our table is absent from the docs page.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const GROQ_DOCS = "https://console.groq.com/docs/models";
const BEDROCK_PRICING = "https://aws.amazon.com/bedrock/pricing/";

function extractVersion(src, constName) {
  const m = src.match(new RegExp(`export const ${constName}\\s*=\\s*"([^"]+)"`));
  return m?.[1] ?? "(missing)";
}

function extractModelKeys(src, tableName) {
  const start = src.indexOf(`export const ${tableName}`);
  if (start < 0) return [];
  const brace = src.indexOf("{", start);
  const end = src.indexOf("};", brace);
  const body = src.slice(brace, end);
  return [...body.matchAll(/"([^"]+)":\s*\{/g)].map(m => m[1]);
}

const groqSrc = readFileSync(resolve(root, "src/lib/pricing/groq.ts"), "utf8");
const bedrockSrc = readFileSync(resolve(root, "src/lib/pricing/bedrock.ts"), "utf8");

const groqVersion = extractVersion(groqSrc, "GROQ_PRICING_VERSION");
const bedrockVersion = extractVersion(bedrockSrc, "BEDROCK_PRICING_VERSION");
const groqModels = extractModelKeys(groqSrc, "GROQ_MODEL_PRICING");
const bedrockModels = extractModelKeys(bedrockSrc, "BEDROCK_MODEL_PRICING");

console.log("SecureMind pricing freshness check (estimates — not invoices)\n");
console.log(`  Groq table:    ${groqVersion}  (${groqModels.length} models)`);
console.log(`  Bedrock table: ${bedrockVersion}  (${bedrockModels.length} models)`);
console.log(`  Ollama:        priced as $0 local (ollama-local-zero)\n`);

console.log("Manual refresh checklist:");
console.log(`  1. Groq:    ${GROQ_DOCS}`);
console.log(`  2. Bedrock: ${BEDROCK_PRICING}`);
console.log("  3. Update rates in src/lib/pricing/groq.ts and bedrock.ts");
console.log("  4. Bump GROQ_PRICING_VERSION / BEDROCK_PRICING_VERSION + EFFECTIVE dates");
console.log("  5. Re-run npm test / this script\n");

console.log("Why not auto-sync?");
console.log("  • Groq has no official pricing API — only docs / console.");
console.log("  • AWS Price List for Bedrock is incomplete for many newer model ids.");
console.log("  • Curated tables stay the source of truth; this script only warns.\n");

let failed = false;

try {
  const res = await fetch(GROQ_DOCS, {
    headers: { "user-agent": "securemind-pricing-check/1.0" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    console.warn(`Groq docs fetch HTTP ${res.status} — skipped live check.`);
  } else {
    const html = (await res.text()).toLowerCase();
    const missing = groqModels.filter(id => !html.includes(id.toLowerCase()));
    if (missing.length === 0) {
      console.log("Groq docs: all curated model ids appear in the page text.");
    } else {
      failed = true;
      console.error("Groq docs: curated model ids NOT found on the pricing/models page:");
      for (const id of missing) console.error(`  - ${id}`);
      console.error("  → Confirm the model is still offered and update rates/ids if needed.");
    }
  }
} catch (err) {
  console.warn(`Groq docs fetch failed (${err?.message ?? err}) — skipped live check.`);
}

console.log(`\nBedrock curated ids (verify manually on AWS pricing page):`);
for (const id of bedrockModels) console.log(`  - ${id}`);

process.exit(failed ? 1 : 0);
