import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("./vendor-secrets", () => ({ resolveVendorApiKey: vi.fn() }));
import { listGoogleModels } from "./google";

afterEach(() => vi.unstubAllGlobals());
describe("Google live catalog", () => {
  it("follows pagination and excludes models without chat generation", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ models: [
        { name: "models/sample-chat", supportedGenerationMethods: ["generateContent"] },
        { name: "models/sample-embed", supportedGenerationMethods: ["embedContent"] },
      ], nextPageToken: "page-two" }))
      .mockResolvedValueOnce(Response.json({ models: [
        { name: "models/sample-other-chat", supportedGenerationMethods: ["generateContent"] },
      ] }));
    vi.stubGlobal("fetch", fetch);
    expect((await listGoogleModels("test-key")).map(m => m.id)).toEqual(["sample-chat", "sample-other-chat"]);
    expect(fetch.mock.calls[1][0]).toContain("pageToken=page-two");
    expect(fetch.mock.calls[0][0]).not.toContain("test-key");
    expect(fetch.mock.calls[0][1].headers["x-goog-api-key"]).toBe("test-key");
  });
  it("does not keep a partial catalog when a subsequent page is rejected", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(Response.json({ models: [], nextPageToken: "two" }))
      .mockResolvedValueOnce(new Response("", { status: 403 })));
    await expect(listGoogleModels("test-key")).rejects.toThrow("403");
  });
});
