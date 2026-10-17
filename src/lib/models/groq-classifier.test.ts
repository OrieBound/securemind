import { beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({ create: vi.fn() }));
const secrets = vi.hoisted(() => ({
  value: { groqApiKey: "gsk_test", instanceGroqApiKey: "gsk_test", externalRiskAcknowledged: true } as Record<string, unknown>,
}));

vi.mock("groq-sdk", () => ({
  default: class {
    chat = { completions: { create: sdk.create } };
  },
}));
vi.mock("@/lib/instance-config", () => ({
  resolveRuntimeSecrets: async () => secrets.value,
}));

import { CLASSIFIER_MODEL, classifyComplexityLlm } from "./groq";
import { TIER_DEFINITIONS, TIER_ORDER } from "./tier-definitions";

function reply(content: string, usage?: { prompt_tokens: number; completion_tokens: number }) {
  return { choices: [{ message: { content } }], usage };
}

beforeEach(() => {
  sdk.create.mockReset();
  secrets.value = { groqApiKey: "gsk_test", instanceGroqApiKey: "gsk_test", externalRiskAcknowledged: true };
});

describe("classifyComplexityLlm", () => {
  it("returns the tier and the tokens the call spent", async () => {
    sdk.create.mockResolvedValue(reply("Plus", { prompt_tokens: 310, completion_tokens: 1 }));
    const r = await classifyComplexityLlm("help me with the thing", "Standard");
    expect(r).toEqual({
      mode: "Plus",
      wasAuto: true,
      model: CLASSIFIER_MODEL,
      usage: { promptTokens: 310, completionTokens: 1 },
    });
  });

  it("reports a valid answer even when it equals the fallback tier", async () => {
    sdk.create.mockResolvedValue(reply("Standard", { prompt_tokens: 300, completion_tokens: 1 }));
    const r = await classifyComplexityLlm("help me with the thing", "Standard");
    expect(r.wasAuto).toBe(true);
    expect(r.mode).toBe("Standard");
    expect(r.usage?.promptTokens).toBe(300);
  });

  it("returns the fallback but keeps the spent tokens when the answer is not a tier", async () => {
    sdk.create.mockResolvedValue(reply("I am not sure", { prompt_tokens: 300, completion_tokens: 4 }));
    const r = await classifyComplexityLlm("help me with the thing", "Standard");
    expect(r.wasAuto).toBe(false);
    expect(r.mode).toBe("Standard");
    expect(r.usage).toEqual({ promptTokens: 300, completionTokens: 4 });
  });

  it("maps the retired tier names High and Fast", async () => {
    sdk.create.mockResolvedValueOnce(reply("High"));
    expect((await classifyComplexityLlm("x", "Standard")).mode).toBe("Max");
    sdk.create.mockResolvedValueOnce(reply("Fast"));
    expect((await classifyComplexityLlm("x", "Standard")).mode).toBe("Light");
  });

  it("makes no call and reports no usage when Groq is not configured", async () => {
    secrets.value = { groqApiKey: null, instanceGroqApiKey: null, externalRiskAcknowledged: false };
    const r = await classifyComplexityLlm("x", "Plus");
    expect(sdk.create).not.toHaveBeenCalled();
    expect(r).toEqual({ mode: "Plus", wasAuto: false });
  });

  it("returns the fallback with no usage when the call fails", async () => {
    sdk.create.mockRejectedValue(new Error("network"));
    const r = await classifyComplexityLlm("x", "Plus");
    expect(r).toEqual({ mode: "Plus", wasAuto: false });
  });

  it("uses the shared tier definitions in its prompt and keeps the call tiny", async () => {
    sdk.create.mockResolvedValue(reply("Light"));
    await classifyComplexityLlm("x", "Standard");
    const args = sdk.create.mock.calls[0][0] as {
      model: string;
      max_tokens: number;
      temperature: number;
      messages: { role: string; content: string }[];
    };
    expect(args.model).toBe(CLASSIFIER_MODEL);
    expect(args.max_tokens).toBeLessThanOrEqual(10);
    expect(args.temperature).toBe(0);
    const system = args.messages[0].content;
    for (const tier of TIER_ORDER) {
      expect(system).toContain(TIER_DEFINITIONS[tier].summary);
    }
  });
});
