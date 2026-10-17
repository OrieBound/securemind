import { describe, expect, it } from "vitest";
import { estimateTokens, selectWorkingMemory, usageToRecord } from "./tokens";

describe("selectWorkingMemory", () => {
  it("keeps a large attached-document extract even when a later reply would overflow", () => {
    const extract = `[Attached document: lease.docx]\n${"clause ".repeat(2000)}`;
    expect(estimateTokens(extract)).toBeGreaterThan(2500);
    const selected = selectWorkingMemory(
      [
        { role: "user", content: extract },
        { role: "assistant", content: "Here is a long summary. ".repeat(80) },
      ],
      2500,
    );
    const user = selected.find(m => m.role === "user");
    expect(user?.content).toContain("[Attached document: lease.docx]");
    expect(user?.content).toContain("clause");
  });

  it("still prefers recent messages when nothing is pinned", () => {
    const selected = selectWorkingMemory(
      [
        { role: "user", content: "old" },
        { role: "assistant", content: "ack" },
        { role: "user", content: "new question" },
      ],
      3000,
    );
    expect(selected.map(m => m.content)).toEqual(["old", "ack", "new question"]);
  });
});

describe("usageToRecord", () => {
  const messages = [{ content: "x".repeat(400) }];

  it("keeps usage the provider reported", () => {
    const reported = { promptTokens: 7, completionTokens: 9 };
    expect(usageToRecord(reported, "openai", messages, "partial")).toBe(reported);
  });

  it("estimates a billable provider's partial reply when no usage was reported", () => {
    expect(usageToRecord(null, "anthropic", messages, "y".repeat(40))).toEqual({
      promptTokens: 100,
      completionTokens: 10,
    });
  });

  it("records nothing when no reply text was produced (failed before generating)", () => {
    expect(usageToRecord(null, "openai", messages, "")).toBeNull();
    expect(usageToRecord(null, "openai", messages, "   \n")).toBeNull();
  });

  it("never estimates for local Ollama", () => {
    expect(usageToRecord(null, "ollama", messages, "some reply")).toBeNull();
    expect(usageToRecord(null, "Ollama", messages, "some reply")).toBeNull();
  });
});
