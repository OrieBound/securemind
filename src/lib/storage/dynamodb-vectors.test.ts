import { describe, expect, it } from "vitest";
import { createDynamoVectorRepository } from "./dynamodb-vectors";
import { createInMemoryVectorEngine, hitFromSearchVectorsScore } from "./vector-engine";
import { cosineSimilarity } from "./vector-math";
import type { DynamoFragmentRecord } from "./dynamodb-schema";

const DIM = 4;
const network = [1, 0, 0, 0];
const budget = [0, 1, 0, 0];
const other = [0, 0, 1, 0];

async function embed(text: string): Promise<number[]> {
  if (text.includes("network")) return network;
  if (text.includes("budget")) return budget;
  return other;
}

function repo() {
  return createDynamoVectorRepository({
    engine: createInMemoryVectorEngine(),
    embed,
    dimensions: DIM,
    minSimilarity: 0.5,
  });
}

async function putDoc(
  r: ReturnType<typeof repo>,
  opts: { id: string; userId: string; workspaceId: string; text: string; embedding: number[]; category?: string },
) {
  await r.put({
    id: opts.id,
    userId: opts.userId,
    workspaceId: opts.workspaceId,
    content: opts.text,
    embedding: opts.embedding,
    documentId: `doc-${opts.id}`,
    documentName: `${opts.id}.txt`,
    category: opts.category,
  });
}

describe("dynamodb vector repository", () => {
  it("returns the closest document in the same workspace and user", async () => {
    const r = repo();
    await putDoc(r, {
      id: "n1",
      userId: "alice",
      workspaceId: "ws-a",
      text: "VPC network ACL rules",
      embedding: network,
    });
    await putDoc(r, {
      id: "b1",
      userId: "alice",
      workspaceId: "ws-a",
      text: "monthly budget spreadsheet",
      embedding: budget,
    });

    const hits = await r.retrieve({
      query: "explain the network ACL",
      workspaceId: "ws-a",
      userId: "alice",
      limit: 10,
    });
    expect(hits.map((h) => h.id)).toEqual(["n1"]);
    expect(hits[0]?.documentName).toBe("n1.txt");
    expect(hits[0]?.similarity).toBeGreaterThanOrEqual(0.99);
  });

  it("does not return another workspace's chunks", async () => {
    const r = repo();
    await putDoc(r, {
      id: "a",
      userId: "alice",
      workspaceId: "ws-a",
      text: "network notes",
      embedding: network,
    });
    await putDoc(r, {
      id: "b",
      userId: "alice",
      workspaceId: "ws-b",
      text: "network notes",
      embedding: network,
    });

    const hits = await r.retrieve({
      query: "network",
      workspaceId: "ws-a",
      userId: "alice",
    });
    expect(hits.map((h) => h.id)).toEqual(["a"]);
  });

  it("does not return another user's chunks in the same workspace id", async () => {
    const r = repo();
    await putDoc(r, {
      id: "mine",
      userId: "alice",
      workspaceId: "ws-shared-id",
      text: "network notes",
      embedding: network,
    });
    await putDoc(r, {
      id: "theirs",
      userId: "bob",
      workspaceId: "ws-shared-id",
      text: "network notes",
      embedding: network,
    });

    const hits = await r.retrieve({
      query: "network",
      workspaceId: "ws-shared-id",
      userId: "alice",
    });
    expect(hits.map((h) => h.id)).toEqual(["mine"]);
  });

  it("does not surface non-document fragments as retrieval hits", async () => {
    const r = repo();
    await putDoc(r, {
      id: "epi",
      userId: "alice",
      workspaceId: "ws-a",
      text: "network gossip",
      embedding: network,
      category: "episodic",
    });
    await putDoc(r, {
      id: "doc",
      userId: "alice",
      workspaceId: "ws-a",
      text: "network policy",
      embedding: network,
    });

    const hits = await r.retrieve({
      query: "network",
      workspaceId: "ws-a",
      userId: "alice",
    });
    expect(hits.map((h) => h.id)).toEqual(["doc"]);
  });

  it("drops hits below the evidence similarity floor", async () => {
    const r = repo();
    await putDoc(r, {
      id: "far",
      userId: "alice",
      workspaceId: "ws-a",
      text: "unrelated",
      embedding: budget,
    });
    const hits = await r.retrieve({
      query: "network",
      workspaceId: "ws-a",
      userId: "alice",
    });
    expect(hits).toEqual([]);
    expect(cosineSimilarity(network, budget)).toBeCloseTo(0);
  });

  it("rejects puts that do not match the locked embedding dimensions", async () => {
    const r = repo();
    await expect(
      r.put({
        id: "x",
        userId: "alice",
        workspaceId: "ws-a",
        content: "nope",
        embedding: [1, 0],
        documentId: "d",
        documentName: "d.txt",
      }),
    ).rejects.toThrow(/locked to 4/);
  });

  it("converts SearchVectors COSINE scores the same way as local cosine", () => {
    const record: DynamoFragmentRecord = {
      workspaceId: "ws",
      fragmentId: "f",
      userId: "u",
      category: "document",
      content: "x",
      documentId: "d",
      documentName: "d.txt",
      provenanceJson: null,
      embedding: network,
    };
    const local = cosineSimilarity(network, network);
    const fromApi = hitFromSearchVectorsScore(record, 1 - local);
    expect(fromApi.similarity).toBeCloseTo(local);
  });

  it("deletes only fragments owned by that userId", async () => {
    const r = repo();
    await putDoc(r, {
      id: "mine",
      userId: "alice",
      workspaceId: "ws-a",
      text: "network notes",
      embedding: network,
    });
    await putDoc(r, {
      id: "theirs",
      userId: "bob",
      workspaceId: "ws-a",
      text: "network notes",
      embedding: network,
    });
    expect(await r.deleteOwned({ workspaceId: "ws-a", userId: "alice", fragmentIds: ["mine", "theirs"] })).toBe(1);
    const aliceHits = await r.retrieve({ query: "network", workspaceId: "ws-a", userId: "alice" });
    const bobHits = await r.retrieve({ query: "network", workspaceId: "ws-a", userId: "bob" });
    expect(aliceHits.map((h) => h.id)).toEqual([]);
    expect(bobHits.map((h) => h.id)).toEqual(["theirs"]);
  });
});
