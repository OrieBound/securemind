import { describe, expect, it, vi } from "vitest";
import { reindexKnowledgeEmbeddings, type ReindexDeps } from "./knowledge-reindex";

function fakeDeps(rows: { id: string; content: string }[], overrides: Partial<ReindexDeps> = {}) {
  const updates: { id: string; userId: string; vector: number[] }[] = [];
  const listChunks = vi.fn(async (o: Parameters<ReindexDeps["listChunks"]>[0]) =>
    rows.filter(r => r.id > o.afterId).slice(0, o.take),
  );
  const deps: ReindexDeps = {
    listChunks,
    updateEmbedding: async u => {
      updates.push(u);
    },
    embedDocument: async text => [text.length],
    usesPrefixes: () => true,
    ...overrides,
  };
  return { deps, updates, listChunks };
}

describe("reindexKnowledgeEmbeddings", () => {
  it("re-embeds every chunk, scoped to the user, across batches", async () => {
    const rows = Array.from({ length: 120 }, (_, i) => ({
      id: `c${String(i).padStart(3, "0")}`,
      content: "x".repeat(i + 1),
    }));
    const { deps, updates, listChunks } = fakeDeps(rows);
    const result = await reindexKnowledgeEmbeddings({ userId: "alice" }, deps);
    expect(result).toEqual({ reindexed: 120, failed: 0 });
    expect(updates).toHaveLength(120);
    expect(updates.every(u => u.userId === "alice")).toBe(true);
    for (const call of listChunks.mock.calls) {
      expect(call[0].userId).toBe("alice");
    }
    expect(listChunks.mock.calls.length).toBeGreaterThan(2);
  });

  it("passes the workspace filter through", async () => {
    const { deps, listChunks } = fakeDeps([{ id: "a", content: "hello" }]);
    await reindexKnowledgeEmbeddings({ userId: "alice", workspaceId: "ws-1" }, deps);
    expect(listChunks.mock.calls[0][0].workspaceId).toBe("ws-1");
  });

  it("counts a failed chunk and keeps going", async () => {
    let n = 0;
    const { deps } = fakeDeps(
      [
        { id: "a", content: "one" },
        { id: "b", content: "two" },
        { id: "c", content: "three" },
      ],
      {
        embedDocument: async () => {
          n++;
          if (n === 2) throw new Error("ollama busy");
          return [1];
        },
      },
    );
    expect(await reindexKnowledgeEmbeddings({ userId: "u" }, deps)).toEqual({ reindexed: 2, failed: 1 });
  });

  it("does nothing when the embedder takes no task prefixes", async () => {
    const { deps, updates, listChunks } = fakeDeps([{ id: "a", content: "hello" }], {
      usesPrefixes: () => false,
    });
    const result = await reindexKnowledgeEmbeddings({ userId: "u" }, deps);
    expect(result.reindexed).toBe(0);
    expect(result.skipped).toMatch(/no task prefixes/i);
    expect(updates).toEqual([]);
    expect(listChunks).not.toHaveBeenCalled();
  });

  it("refuses to run without a userId", async () => {
    const { deps } = fakeDeps([]);
    await expect(reindexKnowledgeEmbeddings({ userId: "" }, deps)).rejects.toThrow(/userId/);
  });
});
