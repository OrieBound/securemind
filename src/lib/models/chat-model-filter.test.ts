import { describe, expect, it } from "vitest";
import { isChatUsableModelId, modalityForListedModel } from "./catalog-shared";
import {
  DEFAULT_TIER_MODELS,
  displayModelForTier,
  effectiveTierOverrides,
  sanitizeTierOverrides,
} from "./tier-assignment";

describe("isChatUsableModelId", () => {
  it("keeps Groq and Gemini chat models, including vision-capable Scout", () => {
    expect(isChatUsableModelId("llama-3.1-8b-instant")).toBe(true);
    expect(isChatUsableModelId("openai/gpt-oss-120b")).toBe(true);
    expect(isChatUsableModelId("meta-llama/llama-4-scout-17b-16e-instruct")).toBe(true);
    expect(isChatUsableModelId("groq/compound")).toBe(true);
    expect(isChatUsableModelId("gemini-2.0-flash")).toBe(true);
    expect(isChatUsableModelId("gemini-3.1-pro-preview")).toBe(true);
  });

  it("rejects TTS, embeddings, image, guard, and retired Gemini 2.5 Flash/Pro", () => {
    expect(isChatUsableModelId("canopylabs/orpheus-v1-english")).toBe(false);
    expect(isChatUsableModelId("whisper-large-v3")).toBe(false);
    expect(isChatUsableModelId("meta-llama/llama-prompt-guard-2-86m")).toBe(false);
    expect(isChatUsableModelId("openai/gpt-oss-safeguard-20b")).toBe(false);
    expect(isChatUsableModelId("nomic-embed-text")).toBe(false);
    expect(isChatUsableModelId("gemini-2.5-flash-preview-tts")).toBe(false);
    expect(isChatUsableModelId("gemini-2.5-flash-image")).toBe(false);
    expect(isChatUsableModelId("gemini-3.1-flash-image-preview")).toBe(false);
    expect(isChatUsableModelId("gemini-2.5-computer-use-preview-10-2025")).toBe(false);
    expect(isChatUsableModelId("lyria-3-clip-preview")).toBe(false);
    expect(isChatUsableModelId("gemini-2.5-flash")).toBe(false);
    expect(isChatUsableModelId("gemini-2.5-pro")).toBe(false);
  });

  it("marks non-chat ids as other and Scout as vision", () => {
    expect(modalityForListedModel("canopylabs/orpheus-v1-english")).toBe("other");
    expect(modalityForListedModel("meta-llama/llama-4-scout-17b-16e-instruct")).toBe("vision");
    expect(modalityForListedModel("llama-3.1-8b-instant")).toBe("text");
  });
});

describe("effectiveTierOverrides", () => {
  it("posts Groq defaults when cloud defaults will run so Insights matches chat", () => {
    expect(effectiveTierOverrides({
      selectionMode: "auto",
      fixedModelId: "openai/gpt-oss-120b",
      overrides: {},
      cloudDefaultsWillRun: true,
    })).toEqual(DEFAULT_TIER_MODELS);
  });

  it("does not post Groq defaults when chat will use local Ollama instead", () => {
    expect(effectiveTierOverrides({
      selectionMode: "auto",
      fixedModelId: "openai/gpt-oss-120b",
      overrides: {},
      cloudDefaultsWillRun: false,
    })).toEqual({});
  });

  it("keeps an explicit assignment and drops TTS leftovers", () => {
    const posted = effectiveTierOverrides({
      selectionMode: "auto",
      fixedModelId: "openai/gpt-oss-120b",
      overrides: {
        Light: "canopylabs/orpheus-v1-english",
        Micro: "llama-3.1-8b-instant",
      },
      cloudDefaultsWillRun: true,
    });
    expect(posted.Light).toBe(DEFAULT_TIER_MODELS.Light);
    expect(posted.Micro).toBe("llama-3.1-8b-instant");
  });

  it("posts the same model on every tier in fixed mode", () => {
    expect(effectiveTierOverrides({
      selectionMode: "fixed",
      fixedModelId: "gemini-2.0-flash",
      overrides: { Micro: "llama-3.1-8b-instant" },
      cloudDefaultsWillRun: false,
    })).toEqual({
      Max: "gemini-2.0-flash",
      Plus: "gemini-2.0-flash",
      Standard: "gemini-2.0-flash",
      Light: "gemini-2.0-flash",
      Micro: "gemini-2.0-flash",
    });
  });
});

describe("displayModelForTier", () => {
  it("shows the local fallback on unassigned rows when cloud defaults will not run", () => {
    expect(displayModelForTier({
      tier: "Micro",
      overrides: {},
      cloudDefaultsWillRun: false,
      localFallbackModel: "llama3.2:latest",
    })).toBe("llama3.2:latest");
  });

  it("shows the Groq default when cloud defaults will run", () => {
    expect(displayModelForTier({
      tier: "Micro",
      overrides: {},
      cloudDefaultsWillRun: true,
      localFallbackModel: "llama3.2:latest",
    })).toBe("llama-3.1-8b-instant");
  });

  it("strips stored TTS ids", () => {
    expect(sanitizeTierOverrides({
      Light: "canopylabs/orpheus-v1-english",
      Micro: "llama-3.1-8b-instant",
    })).toEqual({ Micro: "llama-3.1-8b-instant" });
  });
});
