import { describe, expect, it } from "vitest";
import {
  REFERENCE_OPENAI,
  mergeCatalogWithReference,
  mergeProviderModels,
} from "./reference-catalog";

describe("reference-catalog", () => {
  it("fills empty vendor buckets with curated reference models", () => {
    const merged = mergeCatalogWithReference({
      groq: [],
      bedrock: [],
      ollama: [],
      openai: [],
      anthropic: [],
      google: [],
    });
    expect(merged.some(m => m.provider === "openai")).toBe(true);
    expect(merged.some(m => m.provider === "anthropic")).toBe(true);
    expect(merged.some(m => m.provider === "google")).toBe(true);
    expect(merged.some(m => m.provider === "groq")).toBe(true);
  });

  it("prefers live catalog entries over reference rows with the same id", () => {
    const live = [{ id: "gpt-4o", name: "GPT-4o (live)", provider: "openai" as const, modality: "text" as const }];
    const merged = mergeProviderModels(live, REFERENCE_OPENAI);
    expect(merged.find(m => m.id === "gpt-4o")?.name).toBe("GPT-4o (live)");
  });
});
