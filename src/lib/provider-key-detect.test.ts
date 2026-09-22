import { describe, expect, it } from "vitest";
import { detectProviderKey, isRejectedKeyKind } from "./provider-key-detect";

describe("detectProviderKey", () => {
  it("detects Groq", () => {
    const d = detectProviderKey("gsk_abc123XYZ");
    expect(d.kind).toBe("groq");
    expect(d.wired).toBe(true);
    expect(d.needsAwsPair).toBe(false);
  });

  it("detects AWS access keys and marks them as not accepted", () => {
    const d = detectProviderKey("AKIAIOSFODNN7EXAMPLE");
    expect(d.kind).toBe("bedrock");
    expect(d.wired).toBe(false);
    expect(isRejectedKeyKind(d.kind)).toBe(true);
  });

  it("detects temporary AWS session keys the same way", () => {
    expect(detectProviderKey("ASIAIOSFODNN7EXAMPLE").kind).toBe("bedrock");
  });

  it("detects Google AI Studio keys", () => {
    const d = detectProviderKey("AIzaSyA-abcdefghijklmnopqrstuvwxyz12");
    expect(d.kind).toBe("google");
    expect(d.wired).toBe(true);
  });

  it("detects Google auth (AQ.) keys from AI Studio", () => {
    const d = detectProviderKey("AQ.AbCdEfGhIjKlMnOpQrStUvWxYz0123456789");
    expect(d.kind).toBe("google");
    expect(d.wired).toBe(true);
  });

  it("detects xAI Grok keys and does not treat them as Groq", () => {
    const d = detectProviderKey("xai-abcDEF1234567890");
    expect(d.kind).toBe("xai");
    expect(d.label).toBe("Grok");
    expect(d.wired).toBe(true);
    expect(detectProviderKey("gsk_not_xai").kind).toBe("groq");
  });

  it("detects Anthropic", () => {
    const d = detectProviderKey("sk-ant-api03-xxxxxxxxxxxxxxxxxxxx");
    expect(d.kind).toBe("anthropic");
    expect(d.wired).toBe(true);
  });

  it("detects OpenAI-style sk-", () => {
    const d = detectProviderKey("sk-proj-abcdefghijklmnopqrstuvwxyz123456");
    expect(d.kind).toBe("openai");
    expect(d.wired).toBe(true);
  });

  it("returns unknown for empty / nonsense", () => {
    expect(detectProviderKey("").kind).toBe("unknown");
    expect(detectProviderKey("not-a-real-key").kind).toBe("unknown");
  });
});
