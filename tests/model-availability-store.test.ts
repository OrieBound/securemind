import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";
const memory = vi.hoisted(() => ({ files: new Map<string, string>() }));
vi.mock("node:fs", () => ({
  mkdirSync: vi.fn(),
  readFileSync: (file: string) => {
    if (!memory.files.has(file)) throw Object.assign(new Error("missing"), { code: "ENOENT" });
    return memory.files.get(file);
  },
  writeFileSync: (file: string, data: string) => memory.files.set(file, data),
  renameSync: (from: string, to: string) => { memory.files.set(to, memory.files.get(from)!); memory.files.delete(from); },
}));
vi.mock("@/lib/runtime-env", () => ({ isHostedRuntime: () => false }));
vi.mock("@/lib/instance-config-hosted", () => ({ hostedInstanceConfig: vi.fn() }));
vi.mock("@/lib/instance-config", () => ({ getInstanceAwsStatus: vi.fn(), resolveRuntimeSecrets: vi.fn() }));
vi.mock("@/lib/models/groq", () => ({ selectGroqApiKey: vi.fn() }));
vi.mock("@/lib/models/vendor-secrets", () => ({ resolveVendorApiKey: vi.fn() }));

beforeEach(() => { memory.files.clear(); vi.resetModules(); });
afterEach(() => vi.unstubAllEnvs());
describe("model availability persistence", () => {
  it("uses the persistent data volume in Docker", async () => {
    vi.stubEnv("INSTANCE_KEY_FILE", "/data/instance.key");
    const store = await import("@/lib/models/model-availability-store");
    await store.patchModelAvailability({ id: "sample", provider: "google" }, { hidden: true }, "admin");
    expect(memory.files.has(join("/data", "model-availability.json"))).toBe(true);
    expect((await store.getModelAvailability())["google:sample"].hidden).toBe(true);
  });
  it("preserves simultaneous visibility and verification changes after module reload", async () => {
    const store = await import("@/lib/models/model-availability-store");
    const model = { id: "sample", provider: "google" as const };
    const verification = { ok: true, checkedAt: "2026-09-08T12:00:00Z", scope: "fingerprint" };
    await Promise.all([
      store.patchModelAvailability(model, { hidden: true }, "admin"),
      store.patchModelAvailability(model, { verification }, "admin"),
    ]);
    vi.resetModules();
    const reloaded = await import("@/lib/models/model-availability-store");
    expect(await reloaded.getModelAvailability()).toEqual({ "google:sample": { hidden: true, verification } });
    await reloaded.patchModelAvailability(model, { hidden: false }, "admin");
    expect((await reloaded.getModelAvailability())["google:sample"]).toEqual({ hidden: false, verification });
    expect(memory.files.size).toBe(1);
  });
});
