import { describe, expect, it } from "vitest";
import { estimateTokens, selectWorkingMemory } from "./tokens";

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
