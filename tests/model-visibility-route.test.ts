import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ identity: vi.fn(), patch: vi.fn(), catalog: vi.fn(), invalidate: vi.fn() }));
vi.mock("@/lib/identity", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/identity")>(), getIdentity: mocks.identity,
}));
vi.mock("@/lib/models/catalog", () => ({ getModelCatalogCached: mocks.catalog, invalidateModelCatalogCache: mocks.invalidate }));
vi.mock("@/lib/models/model-availability-store", () => ({ patchModelAvailability: mocks.patch }));
import { PATCH } from "@/app/api/models/catalog/route";

const model = { id: "sample", name: "Sample", provider: "google", modality: "text" };
function request(body: unknown) {
  return new NextRequest("http://localhost/api/models/catalog", {
    method: "PATCH", body: JSON.stringify(body), headers: { "Content-Type": "application/json" },
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.identity.mockResolvedValue({ userId: "admin", role: "admin", authenticated: true, groups: ["Admin"] });
  mocks.catalog.mockResolvedValue({ groq: [], bedrock: [], ollama: [], openai: [], anthropic: [], google: [model], xai: [] });
});
describe("model visibility", () => {
  it("saves a reversible visibility choice using the authenticated identity", async () => {
    for (const hidden of [true, false]) {
      const res = await PATCH(request({ modelId: "sample", provider: "google", hidden, userId: "spoofed" }));
      expect(res.status).toBe(200);
      expect(mocks.patch).toHaveBeenLastCalledWith(model, { hidden }, "admin");
    }
    expect(mocks.invalidate).toHaveBeenCalledTimes(2);
  });
  it("refuses members before reading or writing settings", async () => {
    mocks.identity.mockResolvedValue({ userId: "member", role: "member", authenticated: true, groups: [] });
    expect((await PATCH(request({ modelId: "sample", provider: "google", hidden: true }))).status).toBe(403);
    expect(mocks.catalog).not.toHaveBeenCalled();
    expect(mocks.patch).not.toHaveBeenCalled();
  });
  it("rejects unknown provider/model pairs and malformed flags", async () => {
    expect((await PATCH(request({ modelId: "sample", provider: "ollama", hidden: true }))).status).toBe(404);
    expect((await PATCH(request({ modelId: "sample", provider: "google", hidden: "true" }))).status).toBe(400);
    expect(mocks.patch).not.toHaveBeenCalled();
  });
});
