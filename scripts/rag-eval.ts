/**
 * Knowledge retrieval report. Needs Ollama with nomic-embed-text (docker compose up).
 *
 *   npm run rag:eval
 *
 * Prints, for chunks embedded the old way (legacy) and the current way, where the right
 * passage lands for each golden question and whether an off-topic question wrongly
 * upgrades to a Knowledge-grounded turn. The same checks run as tests/knowledge-golden.test.ts.
 */

import { ollamaReady, runGolden, summarize, type GoldenMode } from "../tests/helpers/knowledge-golden";

async function main() {
  if (!(await ollamaReady())) {
    console.error("Ollama with nomic-embed-text is not reachable. Start it with `docker compose up`.");
    process.exit(1);
  }
  for (const mode of ["legacy", "current"] as GoldenMode[]) {
    const report = await runGolden(mode);
    const s = summarize(report);
    console.log(`\n== ${mode} chunks (${report.chunkCount}) ==`);
    for (const r of report.answerable) {
      const mark = r.rank === 1 ? "✓" : r.rank != null ? "~" : "✗";
      console.log(
        `${mark} rank=${String(r.rank ?? "-").padEnd(2)} strong=${r.strong ? "yes" : "no "} best=${r.bestScore.toFixed(2)}  ${r.q}`,
      );
    }
    console.log(
      `rank-1 ${s.rank1}/${s.total}   in prompt (top 4) ${s.inPrompt}/${s.total}   ` +
        `upgrades a general question ${s.strong}/${s.total}   off-topic wrongly upgraded ${s.offTopicUpgraded}`,
    );
    if (report.offTopicUpgraded.length) console.log("  wrongly upgraded:", report.offTopicUpgraded.join(" | "));
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
