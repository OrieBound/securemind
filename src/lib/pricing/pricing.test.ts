import { describe, expect, it } from "vitest";
import {
  estimateInferenceCost,
  estimateSavingsVsBaseline,
  hasListPrice,
  normalizeBedrockModelId,
} from "./index";

describe("estimateInferenceCost", () => {
  it("prices Groq list rates and never treats unknown as $0", () => {
    const known = estimateInferenceCost({
      provider: "groq",
      model: "llama-3.1-8b-instant",
      promptTokens: 1_000_000,
      completionTokens: 0,
    });
    expect(known.priced).toBe(true);
    // List $0.05/M input + 10% conservative uplift, rounded up.
    expect(known.estimatedCostUsd).toBeCloseTo(0.055, 6);

    const unknown = estimateInferenceCost({
      provider: "groq",
      model: "not-a-real-model",
      promptTokens: 1000,
      completionTokens: 1000,
    });
    expect(unknown.priced).toBe(true);
    expect(unknown.estimatedCostUsd).toBeGreaterThan(0);
  });

  it("prices Bedrock with inference-profile prefix stripped", () => {
    expect(normalizeBedrockModelId("us.amazon.nova-lite-v1:0")).toBe("amazon.nova-lite-v1:0");
    expect(normalizeBedrockModelId("global.amazon.nova-pro-v1:0")).toBe("amazon.nova-pro-v1:0");
    const est = estimateInferenceCost({
      provider: "bedrock",
      model: "us.amazon.nova-lite-v1:0",
      promptTokens: 1_000_000,
      completionTokens: 1_000_000,
    });
    expect(est.priced).toBe(true);
    expect(est.estimatedCostUsd).toBeCloseTo(0.33, 6);

    const globalNova = estimateInferenceCost({
      provider: "bedrock",
      model: "global.amazon.nova-pro-v1:0",
      promptTokens: 1_000_000,
      completionTokens: 0,
    });
    expect(globalNova.estimatedCostUsd).toBeCloseTo(0.88, 6);
  });

  it("applies Admin rate overrides on new turns only (list math)", () => {
    const est = estimateInferenceCost({
      provider: "bedrock",
      model: "global.amazon.nova-lite-v1:0",
      promptTokens: 1_000_000,
      completionTokens: 0,
      rateOverrides: {
        "bedrock:amazon.nova-lite-v1:0": { inputPerM: 1, outputPerM: 2 },
      },
    });
    expect(est.estimatedCostUsd).toBeCloseTo(1.1, 6);
    expect(est.pricingVersion).toContain("override");
  });

  it("ignores rate overrides for local Ollama", () => {
    const est = estimateInferenceCost({
      provider: "ollama",
      model: "llama3.2",
      promptTokens: 1_000_000,
      completionTokens: 1_000_000,
      rateOverrides: {
        "ollama:llama3.2": { inputPerM: 99, outputPerM: 99 },
      },
    });
    expect(est.estimatedCostUsd).toBe(0);
  });

  it("prices Ollama as $0 local", () => {
    const est = estimateInferenceCost({
      provider: "ollama",
      model: "llama3.2",
      promptTokens: 0,
      completionTokens: 0,
    });
    expect(est.priced).toBe(true);
    expect(est.estimatedCostUsd).toBe(0);
  });

  it("estimates savings vs Groq baseline for cheaper routed models", () => {
    const saved = estimateSavingsVsBaseline({
      provider: "groq",
      model: "llama-3.1-8b-instant",
      promptTokens: 1_000_000,
      completionTokens: 0,
    });
    expect(saved).toBeGreaterThan(0);
    expect(hasListPrice("groq", "llama-3.1-8b-instant")).toBe(true);
  });

  describe("direct vendor APIs", () => {
    const million = { promptTokens: 1_000_000, completionTokens: 1_000_000 };

    it("prices vendor models by family prefix, most specific first", () => {
      const nano = estimateInferenceCost({ provider: "openai", model: "gpt-4.1-nano-2025-04-14", ...million });
      // (0.10 + 0.40) * 1.10 = 0.55
      expect(nano.estimatedCostUsd).toBeCloseTo(0.55, 4);
      expect(nano.pricingVersion).toBe("vendor-approx-2026-10");

      const flashLite = estimateInferenceCost({ provider: "google", model: "models/gemini-2.5-flash-lite", ...million });
      expect(flashLite.estimatedCostUsd).toBeCloseTo(0.55, 4);

      const sonnet = estimateInferenceCost({ provider: "anthropic", model: "claude-sonnet-4-6", ...million });
      expect(sonnet.estimatedCostUsd).toBeCloseTo(19.8, 3);

      const grokFast = estimateInferenceCost({ provider: "xai", model: "grok-4.1-fast-reasoning", ...million });
      expect(grokFast.estimatedCostUsd).toBeCloseTo(0.77, 4);
    });

    it("prices old Opus above current Opus", () => {
      const old = estimateInferenceCost({ provider: "anthropic", model: "claude-opus-4-1-20250805", ...million });
      const current = estimateInferenceCost({ provider: "anthropic", model: "claude-opus-4-8", ...million });
      expect(old.estimatedCostUsd).toBeGreaterThan(current.estimatedCostUsd!);
    });

    it("never prices a premium vendor model at the Groq floor", () => {
      const groqFloor = estimateInferenceCost({ provider: "groq", model: "not-a-real-model", ...million });
      for (const [provider, model] of [
        ["openai", "gpt-5.5-pro"],
        ["anthropic", "claude-opus-4-8"],
        ["xai", "grok-4.7"],
        ["google", "gemini-3.1-pro-preview"],
      ] as const) {
        const est = estimateInferenceCost({ provider, model, ...million });
        expect(est.estimatedCostUsd).toBeGreaterThan(groqFloor.estimatedCostUsd!);
      }
    });

    it("uses the per-vendor ceiling for an unmatched model, not $0", () => {
      const est = estimateInferenceCost({ provider: "openai", model: "totally-new-model", ...million });
      // (5 + 30) * 1.10
      expect(est.estimatedCostUsd).toBeCloseTo(38.5, 3);
      expect(est.pricingVersion).toContain("floor-openai");
      expect(hasListPrice("openai", "totally-new-model")).toBe(false);
      expect(hasListPrice("openai", "gpt-4o-mini")).toBe(true);
    });

    it("lets an Admin override apply to a whole model family", () => {
      const est = estimateInferenceCost({
        provider: "openai",
        model: "gpt-4.1-2025-04-14",
        promptTokens: 1_000_000,
        completionTokens: 0,
        rateOverrides: { "openai:gpt-4.1": { inputPerM: 1, outputPerM: 2 } },
      });
      expect(est.estimatedCostUsd).toBeCloseTo(1.1, 6);
      expect(est.pricingVersion).toContain("override");
    });
  });
});
