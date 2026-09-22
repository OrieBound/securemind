import { describe, expect, it } from "vitest";
import { modelKey, withModelAvailability, VERIFICATION_TTL_MS } from "./model-availability";
import { buildChatPickerModels, buildSettingsCatalogModels } from "@/components/app/model-catalog";
import type { CatalogModel } from "./catalog-shared";

const model: CatalogModel = { id: "sample-chat", name: "Sample", provider: "google", modality: "text" };
const now = Date.parse("2026-09-08T12:00:00Z");
const verification = { ok: true, scope: "key-one", checkedAt: new Date(now).toISOString() };
const empty = { groq: [], bedrock: [], ollama: [], openai: [], anthropic: [], google: [], xai: [] };

describe("model availability", () => {
  it("shows connected chat models in menus only after a successful check", () => {
    const models = [
      withModelAvailability(model, undefined, "key-one", now),
      withModelAvailability({ ...model, id: "working" }, { verification }, "key-one", now),
      withModelAvailability({ ...model, id: "failed" }, { verification: { ...verification, ok: false } }, "key-one", now),
      withModelAvailability({ ...model, id: "hidden" }, { verification, hidden: true }, "key-one", now),
    ];
    expect(buildChatPickerModels({ ...empty, google: models }).map(m => m.id)).toEqual(["working"]);
    expect(buildSettingsCatalogModels({ ...empty, google: models })).toHaveLength(4);
  });

  it("invalidates checks on credential change and expiry, preserving the visibility preference", () => {
    expect(withModelAvailability(model, { verification }, "key-two", now).verification).toBe("unverified");
    const expired = withModelAvailability(model, { verification, hidden: true }, "key-one", now + VERIFICATION_TTL_MS);
    expect(expired.verification).toBe("unverified");
    expect(expired.hidden).toBe(true);
    expect(withModelAvailability(model, { verification }, "key-one", now - 1).verification).toBe("unverified");
  });

  it("separates providers with the same model id", () => {
    expect(modelKey(model)).not.toBe(modelKey({ ...model, provider: "ollama" }));
  });

  it("showing a failed model never makes it selectable", () => {
    const failed = withModelAvailability(model, { hidden: false, verification: { ...verification, ok: false } }, "key-one", now);
    expect(buildChatPickerModels({ ...empty, google: [failed] })).toEqual([]);
  });
});
