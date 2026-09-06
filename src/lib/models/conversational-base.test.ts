import { describe, expect, it } from "vitest";
import { buildConversationalBase } from "./router";

describe("buildConversationalBase honesty", () => {
  it("forbids claiming it cannot view attachments", () => {
    const prompt = buildConversationalBase();
    expect(prompt).toMatch(/Never say you cannot view, access, or open attachments/i);
    expect(prompt).toMatch(/Do not invent contents/i);
    expect(prompt).toMatch(/\[category redacted\]/);
    expect(prompt).toMatch(/that was wrong/i);
    expect(prompt).toMatch(/test fixture is not a reason to withhold/i);
    expect(prompt).not.toMatch(/unable to view or access any attachments due to privacy/i);
  });
});
