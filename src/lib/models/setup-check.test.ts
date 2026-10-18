import { describe, expect, it } from "vitest";
import type { CatalogModel } from "./catalog-shared";
import { isAccountWideSetupStop, modelsAwaitingSetupCheck } from "./setup-check";

function model(partial: Partial<CatalogModel> & Pick<CatalogModel, "id">): CatalogModel {
  return {
    name: partial.id,
    provider: "openai",
    modality: "text",
    ...partial,
  };
}

describe("modelsAwaitingSetupCheck", () => {
  it("keeps only unchecked chat models and skips ones already decided for this key", () => {
    const pending = modelsAwaitingSetupCheck([
      model({ id: "gpt-4o-mini" }),
      model({ id: "gpt-4o", verification: "verified" }),
      model({ id: "gpt-4.1", verification: "failed" }),
      model({ id: "whisper-1", modality: "other" }),
      model({ id: "hidden-chat", hidden: true }),
      model({ id: "needs-aws", access: "needs_enablement" }),
    ]);
    expect(pending.map(m => m.id)).toEqual(["gpt-4o-mini"]);
  });
});

describe("isAccountWideSetupStop", () => {
  it("stops the sweep when the account has no quota", () => {
    expect(isAccountWideSetupStop("quota_or_billing")).toBe(true);
  });

  it("stops when the provider cannot be reached", () => {
    expect(isAccountWideSetupStop("error", "getaddrinfo EAI_AGAIN api.groq.com")).toBe(true);
  });

  it("keeps going when one model id is not invocable", () => {
    expect(isAccountWideSetupStop("not_available", "The provider could not run this model id.")).toBe(false);
  });
});

describe("modelsAwaitingSetupCheck with a re-check", () => {
  const started = Date.parse("2026-10-18T12:00:00Z");
  const models = [
    model({ id: "gpt-a", verification: "failed", checkedAt: "2026-10-17T09:00:00Z" }),
    model({ id: "gpt-b", verification: "failed", checkedAt: "2026-10-18T12:00:05Z" }),
    model({ id: "gpt-c", verification: "verified", checkedAt: "2026-10-17T09:00:00Z" }),
    model({ id: "gpt-d", verification: "unverified" }),
  ];

  it("leaves failed models alone on a normal check", () => {
    expect(modelsAwaitingSetupCheck(models).map(m => m.id)).toEqual(["gpt-d"]);
  });

  it("tries an older failure again, once, along with anything unchecked", () => {
    expect(modelsAwaitingSetupCheck(models, { recheckBefore: started }).map(m => m.id)).toEqual(["gpt-a", "gpt-d"]);
  });

  it("does not loop: a failure recorded during the run is newer than the run", () => {
    const afterRetry = models.map(m => (m.id === "gpt-a" ? { ...m, checkedAt: "2026-10-18T12:00:09Z" } : m));
    expect(modelsAwaitingSetupCheck(afterRetry, { recheckBefore: started }).map(m => m.id)).toEqual(["gpt-d"]);
  });

  it("never touches a model that passed", () => {
    expect(modelsAwaitingSetupCheck(models, { recheckBefore: started }).map(m => m.id)).not.toContain("gpt-c");
  });
});