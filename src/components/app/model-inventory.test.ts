import { describe, expect, it } from "vitest";
import { modelBlurb, partitionModels, providerCountsLine } from "@/components/app/model-inventory";
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
    ).toBe("Groq 2 · Gemini 1 · Ollama 1");
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

describe("partitionModels", () => {
  it("keeps models that did not answer apart from the usable ones", () => {
    const groups = partitionModels([
      model({ id: "ok", name: "OK", provider: "anthropic", verification: "verified" }),
      model({ id: "local", name: "Local", provider: "ollama", verification: "installed" }),
      model({ id: "new", name: "New", provider: "openai", verification: "unverified" }),
      model({ id: "bad", name: "Bad", provider: "openai", verification: "failed" }),
      model({ id: "hid", name: "Hidden", provider: "anthropic", verification: "verified", hidden: true }),
      model({ id: "hidbad", name: "Hidden and failed", provider: "google", verification: "failed", hidden: true }),
    ]);
    expect(groups.inMenus.map(m => m.id)).toEqual(["ok", "local"]);
    expect(groups.notChecked.map(m => m.id)).toEqual(["new"]);
    expect(groups.hidden.map(m => m.id)).toEqual(["hid"]);
    expect(groups.failed.map(m => m.id)).toEqual(["bad", "hidbad"]);
  });

  it("puts every model in exactly one group", () => {
    const all = [
      model({ id: "a", name: "A", provider: "groq", verification: "verified" }),
      model({ id: "b", name: "B", provider: "groq" }),
      model({ id: "c", name: "C", provider: "groq", verification: "failed" }),
    ];
    const g = partitionModels(all);
    expect(g.inMenus.length + g.hidden.length + g.notChecked.length + g.failed.length).toBe(all.length);
  });
});
