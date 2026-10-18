import { describe, expect, it } from "vitest";
import type { CatalogModel } from "./catalog-shared";
import { deriveKeyHealth, keyNeedsAttention, relativeTime } from "./key-health";

function model(id: string, extra: Partial<CatalogModel> = {}): CatalogModel {
  return { id, provider: "groq", modality: "text", ...extra } as CatalogModel;
}

describe("deriveKeyHealth", () => {
  it("says nothing when the vendor lists no chat models", () => {
    expect(deriveKeyHealth([])).toBeNull();
    expect(deriveKeyHealth([model("whisper-large-v3", { modality: "other" })])).toBeNull();
  });

  it("is working as soon as one model answered, even if others did not", () => {
    const health = deriveKeyHealth([
      model("llama-3.3-70b-versatile", { verification: "verified", checkedAt: "2026-10-18T10:00:00Z" }),
      model("llama-3.1-8b-instant", { verification: "failed", verificationCode: "not_available" }),
    ])!;
    expect(health.state).toBe("working");
    expect(health.working).toBe(1);
    expect(health.failed).toBe(1);
    expect(health.checkedAt).toBe("2026-10-18T10:00:00Z");
    expect(keyNeedsAttention(health)).toBe(false);
  });

  it("names a key with no credit left", () => {
    const health = deriveKeyHealth([
      model("llama-3.3-70b-versatile", { verification: "failed", verificationCode: "quota_or_billing" }),
      model("llama-3.1-8b-instant", { verification: "unverified" }),
    ])!;
    expect(health.state).toBe("no_quota");
    expect(health.label).toBe("Out of credit");
    expect(keyNeedsAttention(health)).toBe(true);
  });

  it("names a key the provider refuses", () => {
    const health = deriveKeyHealth([
      model("llama-3.3-70b-versatile", { verification: "failed", verificationCode: "access_denied" }),
      model("llama-3.1-8b-instant", { verification: "failed", verificationCode: "access_denied" }),
    ])!;
    expect(health.state).toBe("rejected");
    expect(health.detail).toMatch(/expired or revoked/);
  });

  it("separates a rate limit from a dead key", () => {
    expect(deriveKeyHealth([model("llama-3.3-70b-versatile", { verification: "failed", verificationCode: "throttled" })])!.state).toBe("rate_limited");
  });

  it("puts a billing problem ahead of a rejection when both appear", () => {
    const health = deriveKeyHealth([
      model("a-chat-model", { verification: "failed", verificationCode: "access_denied" }),
      model("b-chat-model", { verification: "failed", verificationCode: "quota_or_billing" }),
    ])!;
    expect(health.state).toBe("no_quota");
  });

  it("falls back to a general failure for other codes", () => {
    expect(deriveKeyHealth([model("llama-3.3-70b-versatile", { verification: "failed", verificationCode: "not_available" })])!.state).toBe("failing");
  });

  it("asks for a first check when nothing was tested", () => {
    const health = deriveKeyHealth([model("llama-3.3-70b-versatile"), model("llama-3.1-8b-instant", { verification: "unverified" })])!;
    expect(health.state).toBe("unchecked");
    expect(health.unchecked).toBe(2);
    expect(keyNeedsAttention(health)).toBe(false);
  });

  it("ignores hidden models and models that need enabling in AWS", () => {
    const health = deriveKeyHealth([
      model("llama-3.3-70b-versatile", { hidden: true, verification: "failed", verificationCode: "access_denied" }),
      model("llama-3.1-8b-instant", { verification: "verified" }),
    ])!;
    expect(health.state).toBe("working");
    expect(health.failed).toBe(0);
  });
});

describe("relativeTime", () => {
  const now = Date.parse("2026-10-18T12:00:00Z");
  it("describes how long ago in plain words", () => {
    expect(relativeTime("2026-10-18T11:59:50Z", now)).toBe("just now");
    expect(relativeTime("2026-10-18T11:55:00Z", now)).toBe("5 minutes ago");
    expect(relativeTime("2026-10-18T09:00:00Z", now)).toBe("3 hours ago");
    expect(relativeTime("2026-10-15T12:00:00Z", now)).toBe("3 days ago");
  });
  it("returns null when there is nothing to describe", () => {
    expect(relativeTime(undefined, now)).toBeNull();
    expect(relativeTime("not a date", now)).toBeNull();
  });
});
