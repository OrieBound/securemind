import { describe, expect, it } from "vitest";
import { buildGeminiBody } from "./google";
import type { ChatMessage } from "./types";

const msgs = (...m: Array<[ChatMessage["role"], string]>): ChatMessage[] => m.map(([role, content]) => ({ role, content }));

describe("buildGeminiBody", () => {
  it("sends system text as a system instruction, not glued onto the oldest message", () => {
    const body = buildGeminiBody(msgs(["system", "RULES"], ["user", "old question"], ["assistant", "old answer"], ["user", "latest"]));
    expect(body.systemInstruction).toEqual({ parts: [{ text: "RULES" }] });
    expect(body.contents.map(c => c.role)).toEqual(["user", "model", "user"]);
    expect(body.contents[0].parts[0].text).toBe("old question");
    expect(JSON.stringify(body.contents)).not.toContain("RULES");
  });

  it("joins several system messages", () => {
    const body = buildGeminiBody(msgs(["system", "A"], ["system", "B"], ["user", "hi"]));
    expect(body.systemInstruction?.parts[0].text).toBe("A\n\nB");
  });

  it("falls back to a single user message when there is only system text", () => {
    const body = buildGeminiBody(msgs(["system", "ONLY"]));
    expect(body.systemInstruction).toBeUndefined();
    expect(body.contents).toEqual([{ role: "user", parts: [{ text: "ONLY" }] }]);
  });

  it("passes the reply limit through", () => {
    expect(buildGeminiBody(msgs(["user", "x"]), 8192).generationConfig).toEqual({ maxOutputTokens: 8192 });
    expect(buildGeminiBody(msgs(["user", "x"])).generationConfig).toBeUndefined();
  });
});
