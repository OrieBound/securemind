import { afterEach, describe, expect, it } from "vitest";
import {
  mirrorDocumentChunkToDynamo,
  purgeDocumentChunksFromDynamo,
} from "./dynamodb-ingest";
import { createDynamoVectorRepository } from "./dynamodb-vectors";
import { createInMemoryVectorEngine } from "./vector-engine";

const vec = [1, 0, 0, 0];

function repo() {
  return createDynamoVectorRepository({
    engine: createInMemoryVectorEngine(),
    embed: async () => vec,
    dimensions: 4,
  });
}

describe("dynamodb ingest mirror", () => {
  const prev = process.env.STORAGE_BACKEND;

  afterEach(() => {
    if (prev === undefined) delete process.env.STORAGE_BACKEND;
    else process.env.STORAGE_BACKEND = prev;
  });

  it("is a no-op when STORAGE_BACKEND is postgres", async () => {
    process.env.STORAGE_BACKEND = "postgres";
    const r = repo();
    const mirrored = await mirrorDocumentChunkToDynamo(
      {
        fragmentId: "f1",
        userId: "alice",
        workspaceId: "ws-a",
        content: "network",
        embedding: vec,
        documentId: "d1",
        documentName: "n.txt",
      },
      r,
    );
    expect(mirrored).toBe(false);
    expect(await r.retrieve({ query: "network", workspaceId: "ws-a", userId: "alice" })).toEqual([]);
  });

  it("writes and purges when STORAGE_BACKEND is dynamodb", async () => {
    process.env.STORAGE_BACKEND = "dynamodb";
    const r = repo();
    const mirrored = await mirrorDocumentChunkToDynamo(
      {
        fragmentId: "f1",
        userId: "alice",
        workspaceId: "ws-a",
        content: "network ACL",
        embedding: vec,
        documentId: "d1",
        documentName: "n.txt",
      },
      r,
    );
    expect(mirrored).toBe(true);
    expect((await r.retrieve({ query: "network", workspaceId: "ws-a", userId: "alice" })).map((h) => h.id)).toEqual([
      "f1",
    ]);
    expect(
      await purgeDocumentChunksFromDynamo(
        { userId: "alice", workspaceId: "ws-a", fragmentIds: ["f1"] },
        r,
      ),
    ).toBe(1);
    expect(await r.retrieve({ query: "network", workspaceId: "ws-a", userId: "alice" })).toEqual([]);
  });
});
