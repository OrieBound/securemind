import { describe, expect, it } from "vitest";
import { mergeLiveFacts } from "@/components/app/memory-dashboard";

const stored = (key: string, value: string) => ({
  id: `db-${key}`,
  key,
  value,
  confidence: 0.9,
  source: null,
  updatedAt: "2026-10-17T00:00:00.000Z",
});

describe("mergeLiveFacts", () => {
  it("keeps the stored fact, and its controls, when the live value is the same", () => {
    const merged = mergeLiveFacts([stored("name", "Dana Reed")], { name: "Dana Reed" });
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("db-name");
  });

  it("shows a live fact when its value differs from the stored one", () => {
    const merged = mergeLiveFacts([stored("name", "Dana Reed")], { name: "Dana R." });
    expect(merged[0].id).toBe("live-name");
    expect(merged[0].value).toBe("Dana R.");
  });

  it("never lets a live extraction override a fact the user pinned or corrected", () => {
    const corrected = { ...stored("preferred_response_length", "medium"), correctedAt: "2026-10-17T01:00:00.000Z" };
    const pinned = { ...stored("name", "Dana Reed"), pinned: true };
    const merged = mergeLiveFacts([corrected, pinned], { preferred_response_length: "short", name: "Dana R." });
    expect(merged.map(f => f.id).sort()).toEqual(["db-name", "db-preferred_response_length"]);
    expect(merged.find(f => f.key === "preferred_response_length")?.value).toBe("medium");
  });

  it("adds a live fact that has not been stored yet and keeps unrelated stored facts", () => {
    const merged = mergeLiveFacts([stored("name", "Dana Reed")], { projects: "Harbour launch" });
    expect(merged.map(f => f.id).sort()).toEqual(["db-name", "live-projects"]);
  });
});
