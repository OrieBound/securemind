import { describe, expect, it } from "vitest";
import { groupDetectionLog, type DetectionLogItem } from "./detection-log";

function item(id: string, at: string): DetectionLogItem {
  return {
    rec: { id, category: "email", context: "contact [email redacted]" },
    entry: { at, turn: 1, workspaceId: "w1", source: "document", documentName: "case.docx" },
  };
}

describe("groupDetectionLog", () => {
  it("hides dismissed rows unless includeDismissed is true", () => {
    const items = [item("a", "2026-09-05T12:00:00.000Z"), item("b", "2026-09-05T13:00:00.000Z")];
    const dismissed = new Set(["a"]);
    const hidden = groupDetectionLog(items, dismissed, false);
    expect(hidden.flatMap(g => g.items.map(i => i.rec.id))).toEqual(["b"]);
    const shown = groupDetectionLog(items, dismissed, true);
    expect(shown.flatMap(g => g.items.map(i => i.rec.id))).toEqual(["b", "a"]);
  });

  it("groups days newest first", () => {
    const items = [
      item("old", "2026-08-01T12:00:00.000Z"),
      item("new", "2026-09-05T12:00:00.000Z"),
    ];
    const groups = groupDetectionLog(items, new Set(), false);
    expect(groups.map(g => g.items.map(i => i.rec.id).join())).toEqual(["new", "old"]);
  });
});
