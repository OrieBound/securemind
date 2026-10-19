import { describe, expect, it } from "vitest";
import { usageFromConverseStreamEvent } from "./bedrock";
import { estimateChatUsage } from "@/lib/tokens";

describe("usageFromConverseStreamEvent", () => {
  it("reads Bedrock ConverseStream metadata usage", () => {
    expect(usageFromConverseStreamEvent({})).toBeNull();
    expect(
      usageFromConverseStreamEvent({
        metadata: { usage: { inputTokens: 120, outputTokens: 40 } },
      }),
    ).toEqual({ promptTokens: 120, completionTokens: 40 });
  });
});

describe("estimateChatUsage", () => {
  it("falls back to a character-based count when the provider omits usage", () => {
    const usage = estimateChatUsage([{ content: "abcd" }], "efghijkl");
    expect(usage.promptTokens).toBe(1);
    expect(usage.completionTokens).toBe(2);
  });
});
