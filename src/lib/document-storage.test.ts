import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { resolve, sep } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildStorageKey, originalExists, readOriginal, removeOriginal, writeOriginal } from "@/lib/document-storage";

describe("document disk storage", () => {
  const previous = process.env.DOCUMENT_STORAGE_PATH;
  const userId = `document-storage-test-${randomUUID()}`;
  const root = resolve(".data", "uploads");
  afterEach(() => {
    const testDir = resolve(root, userId);
    if (!testDir.startsWith(root + sep)) throw new Error("Test cleanup escaped storage root");
    rmSync(testDir, { recursive: true, force: true });
    if (previous === undefined) delete process.env.DOCUMENT_STORAGE_PATH;
    else process.env.DOCUMENT_STORAGE_PATH = previous;
  });
  it("round-trips a file with the default relative storage root", async () => {
    delete process.env.DOCUMENT_STORAGE_PATH;
    const content = Buffer.from("Fictional Harbour document for storage verification.");
    const key = await writeOriginal({ userId, documentId: "doc-one", filename: "brief.txt", buffer: content });
    expect(key).toBe(buildStorageKey(userId, "doc-one", "brief.txt"));
    expect(originalExists(key)).toBe(true);
    expect((await readOriginal(key)).equals(content)).toBe(true);
    removeOriginal(key);
    expect(originalExists(key)).toBe(false);
  });
  it("rejects paths outside the storage root", async () => {
    delete process.env.DOCUMENT_STORAGE_PATH;
    await expect(readOriginal("../../.env.local")).rejects.toThrow("Invalid storage key");
    expect(originalExists("../../.env.local")).toBe(false);
  });
});
