import { beforeEach, describe, expect, it, vi } from "vitest";

const classify = vi.hoisted(() => ({ impl: vi.fn() }));
vi.mock("./groq", () => ({
  classifyComplexityLlm: (...args: unknown[]) => classify.impl(...args),
}));

import {
  applyEvidenceFloors,
  applyTurnPolicyMicro,
  carryOverTier,
  isAmbiguousScore,
  isTrivialMessage,
  looksLikeCode,
  noteFloorNotApplied,
  routeMessage,
  routeMessageSync,
  scoreMessage,
  tierFromScore,
} from "./route-message";
import { ROUTE_FIXTURES, runFixture } from "./route-fixtures";
import { signalPointsTotal } from "./route-scorecard";
import { TIER_ORDER, stepDown, tierRank } from "./tier-definitions";

beforeEach(() => {
  classify.impl.mockReset();
  classify.impl.mockResolvedValue({ mode: "Standard", wasAuto: false });
});

describe("isTrivialMessage", () => {
  it("treats a greeting with at most filler words as Micro-tier trivial", () => {
    expect(isTrivialMessage("Hello there sir!")).toBe(true);
    expect(isTrivialMessage("hi")).toBe(true);
    expect(isTrivialMessage("good morning")).toBe(true);
    expect(isTrivialMessage("hey team")).toBe(true);
  });

  it("does not treat a greeting plus a real question as trivial", () => {
    expect(isTrivialMessage("hey there how are you")).toBe(false);
    expect(isTrivialMessage("hello again")).toBe(false);
    expect(isTrivialMessage("hi can you help me with my lease")).toBe(false);
  });

  it("does not treat ops questions as trivial", () => {
    expect(isTrivialMessage("What failed in the last deploy?")).toBe(false);
  });

  it("never treats image turns as trivial", () => {
    expect(isTrivialMessage("hi", true)).toBe(false);
  });
});

describe("looksLikeCode", () => {
  it("recognises real code", () => {
    expect(looksLikeCode("```js\nconst a = 1;\n```")).toBe(true);
    expect(looksLikeCode("useEffect(() => { run(); }, []);")).toBe(true);
    expect(looksLikeCode("const total = items.reduce(add)")).toBe(true);
    expect(looksLikeCode("if (x) { y(); }")).toBe(true);
  });

  it("does not treat ordinary parentheses or a lone semicolon as code", () => {
    expect(looksLikeCode("Please review the attached file(s).")).toBe(false);
    expect(looksLikeCode("I think (maybe) we should meet (or Friday)")).toBe(false);
    expect(looksLikeCode("first this; then that")).toBe(false);
  });
});

describe("fixtures", () => {
  for (const f of ROUTE_FIXTURES) {
    it(`${f.id}: ${JSON.stringify(f.message).slice(0, 50)} -> ${f.expect}`, () => {
      expect(runFixture(f).tier).toBe(f.expect);
    });
  }

  it("covers every tier", () => {
    const seen = new Set(ROUTE_FIXTURES.map(f => f.expect));
    for (const tier of TIER_ORDER) expect(seen.has(tier), tier).toBe(true);
  });
});

describe("score card", () => {
  it("adds up: baseline plus signal points is the raw score, and the tier matches the result", () => {
    for (const f of ROUTE_FIXTURES) {
      const sync = routeMessageSync({ message: f.message, history: f.history, lastTier: f.lastTier });
      const card = sync.card;
      const expectedRaw = Math.max(0, Math.min(100, card.baseline + signalPointsTotal(card)));
      expect(card.rawScore, f.id).toBe(expectedRaw);
      expect(card.score, f.id).toBeLessThanOrEqual(card.rawScore);
      expect(card.tier, f.id).toBe(sync.tier);
      expect(new Set(card.signals.map(s => s.id)).size, f.id).toBe(card.signals.length);
    }
  });

  it("is deterministic", () => {
    const a = routeMessageSync({ message: "help me think through a move to another city", lastTier: "Plus" });
    const b = routeMessageSync({ message: "help me think through a move to another city", lastTier: "Plus" });
    expect(a.card).toEqual(b.card);
  });

  it("contains no message text, only ids, labels and numbers", () => {
    const secret = "my password is hunter2 and my SIN is 046 454 286";
    const json = JSON.stringify(routeMessageSync({ message: secret }).card);
    expect(json).not.toContain("hunter2");
    expect(json).not.toContain("046");
  });

  it("every tier change has a stated reason", () => {
    for (const f of ROUTE_FIXTURES) {
      const card = runFixture(f);
      if (card.tier !== card.scoreTier) {
        expect(card.adjustments.some(a => a.from !== a.to && a.to === card.tier), f.id).toBe(true);
      }
    }
  });
});

describe("rules that were wrong before", () => {
  it("the rule for messages over 450 characters can now run", () => {
    const long = "word ".repeat(100);
    expect(long.length).toBeGreaterThan(450);
    const ids = scoreMessage(long).signals.map(s => s.id);
    expect(ids).toContain("very-long");
    expect(ids).not.toContain("long");
  });

  it("the canned attachment ask is not scored as code and stays on Standard", () => {
    const r = routeMessageSync({ message: "Please review the attached file(s)." });
    expect(r.signals).not.toContain("code-present");
    expect(r.tier).toBe("Standard");
  });

  it("the canned attachment ask never triggers the tie-break call", async () => {
    const r = await routeMessage({ message: "Please review the attached file(s)." });
    expect(classify.impl).not.toHaveBeenCalled();
    expect(r.tier).toBe("Standard");
  });
});

describe("decaying carry-over", () => {
  it("carries Max as Plus, then Standard, then stops", () => {
    let last = "Max";
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      const r = routeMessageSync({ message: "what about Redis?", lastTier: last });
      seen.push(r.tier);
      last = r.tier;
    }
    expect(seen).toEqual(["Plus", "Standard", "Light", "Light"]);
  });

  it("does not carry a Standard or Light thread", () => {
    for (const last of ["Standard", "Light", "Micro"]) {
      expect(carryOverTier("Light", "what about Redis?", last, ["very-short"]).tier).toBe("Light");
    }
  });

  it("does not carry into a long message or a fresh single-fact question", () => {
    expect(carryOverTier("Light", "x".repeat(200), "Max", []).tier).toBe("Light");
    expect(carryOverTier("Light", "who invented it?", "Max", ["quick-fact"]).tier).toBe("Light");
  });

  it("never lowers a tier that the message earned on its own", () => {
    expect(carryOverTier("Max", "debug this stack trace please", "Plus", ["technical"]).tier).toBe("Max");
  });

  it("states the carry-over on the card", () => {
    const card = routeMessageSync({ message: "what about Redis?", lastTier: "Max" }).card;
    expect(card.adjustments.map(a => a.id)).toContain("carry-over");
  });

  it("stepDown never goes below its floor", () => {
    expect(stepDown("Max", 1, "Standard")).toBe("Plus");
    expect(stepDown("Plus", 1, "Standard")).toBe("Standard");
    expect(stepDown("Standard", 1, "Standard")).toBe("Standard");
    expect(stepDown("Micro")).toBe("Micro");
  });
});

describe("evidence floors", () => {
  const base = () => routeMessageSync({ message: "notice period?" }).card;
  const ctx = (over: Partial<Parameters<typeof applyEvidenceFloors>[1]> = {}) => ({
    message: "notice period?",
    evidencePassages: 0,
    evidenceDocuments: 0,
    attachmentChars: 0,
    ...over,
  });

  it("changes nothing when no document is involved", () => {
    const card = base();
    expect(applyEvidenceFloors(card, ctx())).toBe(card);
  });

  it("raises a document question to Standard, and analysis to Plus", () => {
    expect(applyEvidenceFloors(base(), ctx({ evidencePassages: 2, evidenceDocuments: 1 })).tier).toBe("Standard");
    const analysis = applyEvidenceFloors(
      routeMessageSync({ message: "summarize this" }).card,
      ctx({ message: "summarize this", attachmentChars: 900 }),
    );
    expect(analysis.tier).toBe("Plus");
  });

  it("raises to Plus when three or more documents are involved", () => {
    expect(applyEvidenceFloors(base(), ctx({ evidencePassages: 3, evidenceDocuments: 3 })).tier).toBe("Plus");
  });

  it("never lowers a tier", () => {
    const max = routeMessageSync({ message: "design a complete multi-tenant auth system" }).card;
    expect(max.tier).toBe("Max");
    expect(applyEvidenceFloors(max, ctx({ message: "summarize", evidencePassages: 4, evidenceDocuments: 1 })).tier).toBe("Max");
  });

  it("records the floor on the card without mutating the original", () => {
    const card = base();
    const after = applyEvidenceFloors(card, ctx({ evidencePassages: 1, evidenceDocuments: 1 }));
    expect(card.adjustments.some(a => a.id === "evidence-floor")).toBe(false);
    expect(after.adjustments.at(-1)).toMatchObject({ id: "evidence-floor", from: "Light", to: "Standard" });
  });

  it("can record that a floor was wanted but not applied", () => {
    const card = noteFloorNotApplied(base(), "Plus", "it would exceed the monthly cost cap");
    expect(card.tier).toBe("Light");
    expect(card.adjustments.at(-1)).toMatchObject({ id: "not-applied" });
    expect(card.adjustments.at(-1)?.label).toMatch(/cost cap/);
  });

  it("notes a turn-policy Micro without changing a card already on Micro", () => {
    const micro = routeMessageSync({ message: "thanks" }).card;
    expect(applyTurnPolicyMicro(micro)).toBe(micro);
    const std = routeMessageSync({ message: "how's your day going?" }).card;
    const forced = applyTurnPolicyMicro(std);
    expect(forced.tier).toBe("Micro");
    expect(forced.adjustments.at(-1)).toMatchObject({ id: "turn-policy", from: "Standard", to: "Micro" });
  });
});

describe("tier cutoffs", () => {
  it("maps scores to tiers at the documented boundaries", () => {
    const cases: Array<[number, string]> = [
      [0, "Micro"], [11, "Micro"], [12, "Light"], [35, "Light"], [36, "Standard"],
      [51, "Standard"], [52, "Plus"], [65, "Plus"], [66, "Max"], [100, "Max"],
    ];
    for (const [score, tier] of cases) expect(tierFromScore(score), String(score)).toBe(tier);
  });

  it("orders the tiers from least to most capable", () => {
    expect(tierRank("Micro")).toBeLessThan(tierRank("Light"));
    expect(tierRank("Plus")).toBeLessThan(tierRank("Max"));
  });
});

describe("tie-break", () => {
  it("is only considered when no signal states the intent and the score is mid-band", () => {
    expect(isAmbiguousScore(40, [])).toBe(true);
    expect(isAmbiguousScore(40, ["planning"])).toBe(false);
    expect(isAmbiguousScore(60, [])).toBe(false);
  });

  const ambiguous = "can you give me a hand with the thing we were talking about earlier";

  it("uses the small model's tier and records its cost on the card", async () => {
    classify.impl.mockResolvedValue({
      mode: "Plus",
      wasAuto: true,
      model: "llama-3.1-8b-instant",
      usage: { promptTokens: 300, completionTokens: 2 },
    });
    expect(routeMessageSync({ message: ambiguous }).card.scoreTier).toBe("Standard");
    const r = await routeMessage({ message: ambiguous });
    expect(classify.impl).toHaveBeenCalledTimes(1);
    expect(r.tier).toBe("Plus");
    expect(r.card.classifier.used).toBe(true);
    expect(r.card.classifier.model).toBe("llama-3.1-8b-instant");
    expect(r.card.classifier.promptTokens).toBe(300);
    expect(r.card.classifier.costUsd).toBeGreaterThan(0);
    expect(r.card.classifier.costUsd).toBeLessThan(0.001);
    expect(r.card.adjustments.some(a => a.id === "classifier")).toBe(true);
  });

  it("still counts the cost when the small model agrees with the rules' tier", async () => {
    classify.impl.mockResolvedValue({
      mode: "Standard",
      wasAuto: true,
      model: "llama-3.1-8b-instant",
      usage: { promptTokens: 300, completionTokens: 2 },
    });
    const r = await routeMessage({ message: ambiguous });
    expect(r.tier).toBe("Standard");
    expect(r.card.classifier.used).toBe(true);
    expect(r.card.classifier.costUsd).toBeGreaterThan(0);
  });

  it("keeps the rules' tier but still records the cost when the answer is unusable", async () => {
    classify.impl.mockResolvedValue({
      mode: "Standard",
      wasAuto: false,
      model: "llama-3.1-8b-instant",
      usage: { promptTokens: 300, completionTokens: 10 },
    });
    const r = await routeMessage({ message: ambiguous });
    expect(r.tier).toBe("Standard");
    expect(r.card.classifier.used).toBe(true);
    expect(r.card.classifier.tier).toBeUndefined();
    expect(r.card.classifier.costUsd).toBeGreaterThan(0);
  });

  it("uses the rules alone, with no cost, when no cheap model is available", async () => {
    const r = await routeMessage({ message: ambiguous });
    expect(r.card.classifier.used).toBe(false);
    expect(r.card.classifier.costUsd).toBeUndefined();
    expect(r.tier).toBe("Standard");
  });

  it("never maps a real message to Micro", async () => {
    classify.impl.mockResolvedValue({ mode: "Micro", wasAuto: true, model: "m", usage: { promptTokens: 1, completionTokens: 1 } });
    const r = await routeMessage({ message: ambiguous });
    expect(r.tier).toBe("Standard");
  });

  it("is skipped for trivial messages", async () => {
    await routeMessage({ message: "thanks" });
    expect(classify.impl).not.toHaveBeenCalled();
  });
});

describe("routeMessageSync", () => {
  it("routes greetings to Micro without a scoring path", () => {
    const r = routeMessageSync({ message: "Hello there sir!" });
    expect(r.isTrivial).toBe(true);
    expect(r.tier).toBe("Micro");
    expect(r.card.signals.map(s => s.id)).toEqual(["trivial"]);
  });

  it("uses the fallback for an empty message", () => {
    const r = routeMessageSync({ message: "   ", fallback: "Plus" });
    expect(r.tier).toBe("Plus");
    expect(r.wasAuto).toBe(false);
  });
});
