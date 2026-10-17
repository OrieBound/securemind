import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const embedded: string[] = [];

vi.mock("@/lib/models/ollama", () => ({
  embedText: vi.fn(async (text: string) => {
    embedded.push(text);
    return [text.length];
  }),
}));

import {
  NOMIC_DOCUMENT_PREFIX,
  NOMIC_QUERY_PREFIX,
  embedDocumentText,
  embedQueryVariants,
  embedderUsesTaskPrefixes,
} from "./embed";

const saved = { provider: process.env.EMBED_PROVIDER, model: process.env.OLLAMA_EMBED_MODEL };

beforeEach(() => {
  embedded.length = 0;
  process.env.EMBED_PROVIDER = "ollama";
  delete process.env.OLLAMA_EMBED_MODEL;
});

afterEach(() => {
  if (saved.provider === undefined) delete process.env.EMBED_PROVIDER;
  else process.env.EMBED_PROVIDER = saved.provider;
  if (saved.model === undefined) delete process.env.OLLAMA_EMBED_MODEL;
  else process.env.OLLAMA_EMBED_MODEL = saved.model;
});

describe("nomic task prefixes", () => {
  it("prefixes stored document text on a nomic install", async () => {
    expect(embedderUsesTaskPrefixes()).toBe(true);
    await embedDocumentText("The rent is $2,475.");
    expect(embedded).toEqual([`${NOMIC_DOCUMENT_PREFIX}The rent is $2,475.`]);
  });

  it("searches with both the raw and the prefixed question", async () => {
    const vectors = await embedQueryVariants("monthly rent");
    expect(vectors).toHaveLength(2);
    expect(embedded.sort()).toEqual(["monthly rent", `${NOMIC_QUERY_PREFIX}monthly rent`].sort());
  });

  it("adds no prefix for a different Ollama embedding model", async () => {
    process.env.OLLAMA_EMBED_MODEL = "mxbai-embed-large";
    expect(embedderUsesTaskPrefixes()).toBe(false);
    await embedDocumentText("plain text");
    expect(embedded).toEqual(["plain text"]);
    embedded.length = 0;
    expect(await embedQueryVariants("plain question")).toHaveLength(1);
    expect(embedded).toEqual(["plain question"]);
  });

  it("adds no prefix on the hosted Bedrock embedder", () => {
    process.env.EMBED_PROVIDER = "bedrock";
    expect(embedderUsesTaskPrefixes()).toBe(false);
  });
});
