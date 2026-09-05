import { describe, expect, it } from "vitest";
import { buildConversationalBase } from "./router";

describe("buildConversationalBase honesty", () => {
  it("forbids inventing a privacy wall and invented file contents", () => {
    const prompt = buildConversationalBase();
    expect(prompt).toMatch(/Never invent a privacy, security, or product rule/i);
    expect(prompt).toMatch(/Do not refuse the file/i);
    expect(prompt).toMatch(/Do not invent contents/i);
    expect(prompt).toMatch(/\[category redacted\]/);
  });
});
