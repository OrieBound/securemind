import { beforeEach, describe, expect, it, vi } from "vitest";

const patchModelAvailability = vi.fn(async () => {});
const invalidateModelCatalogCache = vi.fn();

vi.mock("./model-availability-store", () => ({
  patchModelAvailability: (...a: unknown[]) => patchModelAvailability(...(a as [])),
  modelCredentialScope: vi.fn(async () => "scope-1"),
}));
vi.mock("./catalog", () => ({ invalidateModelCatalogCache: () => invalidateModelCatalogCache() }));

import { isModelGoneError, RETIRED_MODEL_NOTE, retireModelAfterChatFailure } from "./retire-failed-model";

beforeEach(() => vi.clearAllMocks());

const deprecated = new Error(
  'OpenAI chat failed (404): { "error": { "message": "The model `gpt-4-0613` has been deprecated, learn more here: https://platform.openai.com/docs/deprecations", "type": "invalid_request_error" } }',
);

describe("a model the provider has retired", () => {
  it("is recorded as failed and taken off the active lists", async () => {
    const note = await retireModelAfterChatFailure({ err: deprecated, provider: "openai", model: "gpt-4-0613", userId: "u1" });
    expect(note).toBe(RETIRED_MODEL_NOTE);
    expect(patchModelAvailability).toHaveBeenCalledTimes(1);
    const [model, patch, user] = patchModelAvailability.mock.calls[0] as unknown as [
      { id: string; provider: string },
      { verification: { ok: boolean; code: string; scope: string; checkedAt: string } },
      string,
    ];
    expect(model).toEqual({ id: "gpt-4-0613", provider: "openai" });
    expect(patch.verification).toMatchObject({ ok: false, code: "not_available", scope: "scope-1" });
    expect(Number.isNaN(Date.parse(patch.verification.checkedAt))).toBe(false);
    expect(user).toBe("u1");
    expect(invalidateModelCatalogCache).toHaveBeenCalled();
  });

  it("covers the other providers' wording for a missing model", async () => {
    for (const [provider, text] of [
      ["anthropic", "Anthropic chat failed (404): model: claude-old not_found_error"],
      ["google", "Google Gemini chat failed (404): models/gemini-old is not found for API version v1beta"],
      ["groq", "404 The model `old-model` has been decommissioned"],
    ] as const) {
      const note = await retireModelAfterChatFailure({ err: new Error(text), provider, model: "x", userId: "u1" });
      expect(note, provider).toBe(RETIRED_MODEL_NOTE);
    }
  });
});

describe("temporary problems leave the model on the list", () => {
  it.each([
    ["a rate limit", "OpenAI chat failed (429): Rate limit reached"],
    ["a billing problem", "OpenAI chat failed (429): You exceeded your current quota, insufficient_quota"],
    ["a timeout", "Request timed out"],
    ["a provider outage", "OpenAI chat failed (503): The server is overloaded"],
  ])("%s", async (_name, text) => {
    const note = await retireModelAfterChatFailure({ err: new Error(text), provider: "openai", model: "gpt-x", userId: "u1" });
    expect(note).toBeNull();
    expect(patchModelAvailability).not.toHaveBeenCalled();
  });

  it("never unlists a local model", async () => {
    const note = await retireModelAfterChatFailure({
      err: new Error("Ollama chat failed (404): model 'llama3' not found"),
      provider: "ollama",
      model: "llama3",
      userId: "u1",
    });
    expect(note).toBeNull();
    expect(patchModelAvailability).not.toHaveBeenCalled();
  });

  it("does not break the error path if saving fails", async () => {
    patchModelAvailability.mockRejectedValueOnce(new Error("disk full"));
    const note = await retireModelAfterChatFailure({ err: deprecated, provider: "openai", model: "gpt-4-0613", userId: "u1" });
    expect(note).toBeNull();
  });
});

describe("isModelGoneError", () => {
  it("separates a retired model from a temporary failure", () => {
    expect(isModelGoneError(deprecated, "openai", "gpt-4-0613").gone).toBe(true);
    expect(isModelGoneError(new Error("OpenAI chat failed (429): Rate limit"), "openai", "gpt-4o").gone).toBe(false);
  });
});
