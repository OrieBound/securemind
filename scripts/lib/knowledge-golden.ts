/**
 * Golden Knowledge retrieval harness.
 *
 * Runs the app's real extraction, chunking, embedding and ranking against the synthetic
 * tenancy agreement, so a change to any of them shows up as a measured drop in how often
 * the right passage is retrieved. Needs a local Ollama with nomic-embed-text.
 * Shared by tests/knowledge-golden.test.ts and `npm run rag:eval`. Lives under scripts/ (not
 * tests/) because the Docker image excludes tests/ but typechecks scripts/.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chunkText, extractText, resolveMimeType } from "../../src/lib/documents";
import { embedDocumentText, embedQueryVariants, embedText } from "../../src/lib/models/embed";
import { EVIDENCE_PROMPT_LIMIT } from "../../src/lib/memory";
import { CANDIDATE_VECTOR_FLOOR, rankHits, strongHits } from "../../src/lib/retrieval-rank";
import { cosineSimilarity } from "../../src/lib/storage/vector-math";

export type GoldenFixture = {
  document: string;
  answerable: { q: string; expect: string }[];
  offTopic: { q: string }[];
};

/** `legacy` = chunks embedded as raw text (before task prefixes); `current` = prefixed. */
export type GoldenMode = "legacy" | "current";

export type AnswerableResult = {
  q: string;
  /** 1-based position of the answer chunk among ranked hits, or null if it was dropped. */
  rank: number | null;
  /** Answer chunk is among the hits that a general question could upgrade on. */
  strong: boolean;
  bestScore: number;
};

export type GoldenReport = {
  mode: GoldenMode;
  chunkCount: number;
  answerable: AnswerableResult[];
  /** Off-topic questions that still produced a hit strong enough to upgrade a general turn. */
  offTopicUpgraded: string[];
};

export function loadFixture(): GoldenFixture {
  const path = resolve(__dirname, "../../tests/fixtures/knowledge-golden.json");
  return JSON.parse(readFileSync(path, "utf8")) as GoldenFixture;
}

export async function ollamaReady(): Promise<boolean> {
  const base = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
  try {
    const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return false;
    const body = (await res.json()) as { models?: { name: string }[] };
    return (body.models ?? []).some(m => m.name.startsWith("nomic-embed-text"));
  } catch {
    return false;
  }
}

export async function runGolden(mode: GoldenMode): Promise<GoldenReport> {
  const fixture = loadFixture();
  const root = resolve(__dirname, "../..");
  const file = resolve(root, fixture.document);
  const name = file.split(/[\/]/).pop() ?? "doc";
  const text = await extractText(readFileSync(file), resolveMimeType("", name), name);
  const chunks = chunkText(text);
  const embed = mode === "legacy" ? embedText : embedDocumentText;
  const vectors: number[][] = [];
  for (const chunk of chunks) vectors.push(await embed(chunk));

  async function search(query: string) {
    const variants = await embedQueryVariants(query);
    const candidates = chunks
      .map((content, i) => ({
        id: String(i),
        content,
        // A chunk keeps its best similarity across the query forms, as in production.
        similarity: Math.max(...variants.map(v => cosineSimilarity(v, vectors[i]))),
      }))
      .filter(c => c.similarity >= CANDIDATE_VECTOR_FLOOR);
    return rankHits(candidates, query, 10);
  }

  const answerable: AnswerableResult[] = [];
  for (const { q, expect } of fixture.answerable) {
    const ranked = await search(q);
    const idx = ranked.findIndex(h => h.content.includes(expect));
    const strong = strongHits(ranked).slice(0, EVIDENCE_PROMPT_LIMIT);
    answerable.push({
      q,
      rank: idx === -1 ? null : idx + 1,
      strong: strong.some(h => h.content.includes(expect)),
      bestScore: ranked[0]?.score ?? 0,
    });
  }

  const offTopicUpgraded: string[] = [];
  for (const { q } of fixture.offTopic) {
    if (strongHits(await search(q)).length > 0) offTopicUpgraded.push(q);
  }

  return { mode, chunkCount: chunks.length, answerable, offTopicUpgraded };
}

export function summarize(report: GoldenReport) {
  const n = report.answerable.length;
  const inPrompt = report.answerable.filter(r => r.rank != null && r.rank <= EVIDENCE_PROMPT_LIMIT).length;
  return {
    total: n,
    rank1: report.answerable.filter(r => r.rank === 1).length,
    inPrompt,
    strong: report.answerable.filter(r => r.strong).length,
    offTopicUpgraded: report.offTopicUpgraded.length,
  };
}
