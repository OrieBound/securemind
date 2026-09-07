import { describe, expect, it } from "vitest";
import { modelBlurb, providerCountsLine } from "@/components/app/model-inventory";
import type { CatalogModel } from "@/components/app/model-catalog";

function model(partial: Partial<CatalogModel> & Pick<CatalogModel, "id" | "name" | "provider">): CatalogModel {
  return { modality: "text", ...partial };
}

describe("model inventory copy", () => {
  it("summarizes counts by provider", () => {
    expect(
      providerCountsLine([
        model({ id: "a", name: "A", provider: "groq" }),
        model({ id: "b", name: "B", provider: "groq" }),
        model({ id: "c", name: "C", provider: "google" }),
        model({ id: "d", name: "D", provider: "ollama" }),
      ]),
    ).toBe("Groq 2 · Google 1 · Ollama 1");
  });

  it("uses a short blurb per family instead of hiding vendor models", () => {
    expect(modelBlurb(model({ id: "llama-3.1-8b-instant", name: "Llama 3.1 8B", provider: "groq" }))).toMatch(/Groq/);
    expect(
      modelBlurb(model({ id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", provider: "google" })),
    ).toMatch(/Gemini/);
    expect(
      modelBlurb(model({ id: "llama3.2:3b", name: "llama3.2:3b", provider: "ollama", note: "Ollama · local" })),
    ).toMatch(/this machine/);
    expect(
      modelBlurb(
        model({
          id: "us.anthropic.claude-opus-4-6",
          name: "Claude Opus 4.6",
          provider: "bedrock",
          access: "needs_enablement",
        }),
      ),
    ).toMatch(/Model catalog/);
  });
});
