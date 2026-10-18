import { describe, expect, it } from "vitest";
import { pickBackgroundVendorModel } from "@/lib/models/background-model";
import type { CatalogModel } from "@/lib/models/catalog-shared";

function m(partial: Partial<CatalogModel> & Pick<CatalogModel, "id" | "provider">): CatalogModel {
  return { name: partial.id, modality: "text", verification: "verified", ...partial };
}

describe("pickBackgroundVendorModel", () => {
  it("prefers the newest verified small Anthropic model", () => {
    const pick = pickBackgroundVendorModel([
      m({ id: "claude-sonnet-5-5", provider: "anthropic" }),
      m({ id: "claude-haiku-4-5-20251001", provider: "anthropic" }),
      m({ id: "claude-haiku-5-5", provider: "anthropic" }),
      m({ id: "gpt-4.1-nano", provider: "openai" }),
    ]);
    expect(pick).toEqual({ model: "claude-haiku-5-5", provider: "anthropic" });
  });

  it("never picks a model that has not answered a test, is hidden, failed or is not for chat", () => {
    expect(
      pickBackgroundVendorModel([
        m({ id: "claude-haiku-5-5", provider: "anthropic", verification: "unverified" }),
        m({ id: "claude-haiku-4-5", provider: "anthropic", verification: "failed" }),
        m({ id: "claude-haiku-4-6", provider: "anthropic", hidden: true }),
        m({ id: "gpt-4.1-mini", provider: "openai", modality: "other" }),
        m({ id: "gpt-4.1-nano", provider: "openai", access: "needs_enablement" }),
      ]),
    ).toBeNull();
  });

  it("falls through to the next vendor family and ignores large models", () => {
    expect(
      pickBackgroundVendorModel([
        m({ id: "claude-opus-5-5", provider: "anthropic" }),
        m({ id: "gpt-4.1-mini", provider: "openai" }),
      ]),
    ).toEqual({ model: "gpt-4.1-mini", provider: "openai" });
  });

  it("returns null when nothing qualifies", () => {
    expect(pickBackgroundVendorModel([])).toBeNull();
  });
});
