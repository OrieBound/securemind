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
});
