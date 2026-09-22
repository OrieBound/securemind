import { describe, expect, it } from "vitest";
import { grokDisplayName, isGrokChatModelId } from "./xai";

describe("Grok catalog filter", () => {
  it("keeps Grok chat models and drops image, video, and non-Grok ids", () => {
    expect(isGrokChatModelId("grok-4")).toBe(true);
    expect(isGrokChatModelId("grok-3-mini")).toBe(true);
    expect(isGrokChatModelId("grok-2-vision-1212")).toBe(true);
    expect(isGrokChatModelId("grok-2-image")).toBe(false);
    expect(isGrokChatModelId("grok-imagine-1")).toBe(false);
    expect(isGrokChatModelId("flux-1")).toBe(false);
    expect(isGrokChatModelId("llama-3.3-70b-versatile")).toBe(false);
  });

  it("formats ids as Grok display names", () => {
    expect(grokDisplayName("grok-4")).toBe("Grok 4");
    expect(grokDisplayName("grok-3-mini")).toBe("Grok 3 Mini");
  });
});
