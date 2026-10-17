import { describe, expect, it } from "vitest";
import { ollamaReady, runGolden, summarize, type GoldenMode } from "./helpers/knowledge-golden";

/**
 * Golden Knowledge retrieval check against the synthetic tenancy agreement.
 *
 * Uses the real chunker, the real embedding model and the real ranking. It needs a local
 * Ollama with nomic-embed-text, so it skips itself in CI and anywhere Ollama is not
 * running. Run it with `docker compose up` (or `ollama serve`) before changing retrieval.
 * Measured when it was added: 12/12 answers reach the prompt, 0 off-topic upgrades.
 * Before the hybrid ranking only 8/12 reached it.
 */
const ready = await ollamaReady();

// Embedding the document is the slow part, so run each mode once and share the report.
const reports = new Map<GoldenMode, ReturnType<typeof runGolden>>();
function report(mode: GoldenMode) {
  if (!reports.has(mode)) reports.set(mode, runGolden(mode));
  return reports.get(mode)!;
}

describe.skipIf(!ready)("Knowledge retrieval golden set", () => {
  const modes: GoldenMode[] = ["current", "legacy"];

  for (const mode of modes) {
    it(`finds the answer for real questions (${mode} chunks)`, async () => {
      const r = await report(mode);
      const s = summarize(r);

      // The answer chunk reaches the prompt (top 4) for all but at most one question.
      expect(s.inPrompt, `in prompt: ${JSON.stringify(r.answerable)}`).toBeGreaterThanOrEqual(s.total - 1);
      // A general-phrased question can upgrade to a grounded turn for the same set.
      expect(s.strong).toBeGreaterThanOrEqual(s.total - 1);
      // Usually the very first hit.
      expect(s.rank1).toBeGreaterThanOrEqual(Math.floor(s.total * 0.75));
    }, 120_000);

    it(`does not upgrade unrelated questions (${mode} chunks)`, async () => {
      const r = await report(mode);
      expect(r.offTopicUpgraded).toEqual([]);
    }, 120_000);
  }
});
