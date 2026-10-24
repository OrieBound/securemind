/**
 * Task models: any signed-in member can see which file helper is set, only an Admin can change it,
 * the helper must be a model the live catalog lists, and /api/files/format never reaches a model
 * without a helper, a signed-in caller, or consent.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { IdentityError } from "@/lib/identity";

const getIdentity = vi.fn();
const resolveAllowedModel = vi.fn();
const consent = { externalRiskAckAt: "2026-01-01" as string | null };
const patchInstanceConfig = vi.fn();
const streamChat = vi.fn();

vi.mock("@/lib/identity", async () => {
  const actual = await vi.importActual<typeof import("@/lib/identity")>("@/lib/identity");
  return { ...actual, getIdentity: (...a: unknown[]) => getIdentity(...a) };
});
vi.mock("@/lib/models/allowlist", () => ({ resolveAllowedModel: (...a: unknown[]) => resolveAllowedModel(...a) }));
vi.mock("@/lib/models/provider", () => ({ streamChat: (...a: unknown[]) => streamChat(...a) }));
vi.mock("@/lib/instance-config", () => {
  class ProviderConfigError extends Error {
    status = 422;
  }
  return {
    ProviderConfigError,
    patchInstanceConfig: (...a: unknown[]) => patchInstanceConfig(...a),
    getVendorConsentFlags: vi.fn(async () => ({ ...consent })),
    instanceCanUseBedrock: vi.fn(async () => false),
  };
});
vi.mock("@/lib/instance-config-hosted", () => ({ hostedInstanceConfig: () => ({ get: async () => null, merge: async () => ({}) }) }));
vi.mock("@/lib/runtime-env", () => ({ isHostedRuntime: () => false }));

// The real store runs against a temp folder, so the route and the formatter share one setting.
const dir = mkdtempSync(join(tmpdir(), "task-models-"));
process.env.INSTANCE_KEY_FILE = join(dir, "instance.key");
const storeFile = join(dir, "task-models.json");
async function setStore(choice: { provider: string; model: string } | null) {
  const { setTaskModel: real } = await vi.importActual<typeof import("@/lib/models/task-models")>("@/lib/models/task-models");
  await real("fileFormat", choice as never, "seed");
}
async function stored() {
  try {
    return JSON.parse(readFileSync(storeFile, "utf8")).fileFormat ?? null;
  } catch {
    return null;
  }
}

const member = { userId: "u1", role: "member" };
const admin = { userId: "a1", role: "admin" };

function req(path: string, method: string, body?: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  rmSync(storeFile, { force: true });
  consent.externalRiskAckAt = "2026-01-01";
  resolveAllowedModel.mockResolvedValue({ model: "gpt-mini", provider: "openai" });
  const { resetRateLimits } = await import("@/lib/rate-limit");
  resetRateLimits();
});

describe("/api/settings/task-models", () => {
  it("lets a member read the setting but not change it", async () => {
    const { GET, PUT } = await import("@/app/api/settings/task-models/route");
    getIdentity.mockResolvedValue(member);
    const got = await GET(req("/api/settings/task-models", "GET"));
    expect(got.status).toBe(200);
    expect((await got.json()).canEdit).toBe(false);
    const denied = await PUT(req("/api/settings/task-models", "PUT", { purpose: "fileFormat", model: "gpt-mini" }));
    expect(denied.status).toBe(403);
    expect(await stored()).toBeNull();
  });

  it("lets an Admin approve a catalog model", async () => {
    const { PUT } = await import("@/app/api/settings/task-models/route");
    getIdentity.mockResolvedValue(admin);
    const res = await PUT(req("/api/settings/task-models", "PUT", { purpose: "fileFormat", model: "gpt-mini", provider: "openai" }));
    expect(res.status).toBe(200);
    expect(await stored()).toMatchObject({ provider: "openai", model: "gpt-mini", setByUserId: "a1" });
  });

  it("refuses a model the catalog does not list, or a provider mismatch", async () => {
    const { PUT } = await import("@/app/api/settings/task-models/route");
    getIdentity.mockResolvedValue(admin);
    resolveAllowedModel.mockResolvedValue(null);
    expect((await PUT(req("/api/settings/task-models", "PUT", { purpose: "fileFormat", model: "made-up" }))).status).toBe(422);
    resolveAllowedModel.mockResolvedValue({ model: "gpt-mini", provider: "openai" });
    expect((await PUT(req("/api/settings/task-models", "PUT", { purpose: "fileFormat", model: "gpt-mini", provider: "groq" }))).status).toBe(422);
    expect(await stored()).toBeNull();
  });

  it("needs the vendor consent notice before a vendor model is approved", async () => {
    const { PUT } = await import("@/app/api/settings/task-models/route");
    getIdentity.mockResolvedValue(admin);
    consent.externalRiskAckAt = null;
    const refused = await PUT(req("/api/settings/task-models", "PUT", { purpose: "fileFormat", model: "gpt-mini" }));
    expect(refused.status).toBe(422);
    expect(await stored()).toBeNull();
    const accepted = await PUT(req("/api/settings/task-models", "PUT", { purpose: "fileFormat", model: "gpt-mini", acknowledgeExternalRisk: true }));
    expect(accepted.status).toBe(200);
    expect(patchInstanceConfig).toHaveBeenCalledWith({ acknowledgeExternalRisk: true }, "a1");
  });

  it("turns the helper off with a null model", async () => {
    const { PUT } = await import("@/app/api/settings/task-models/route");
    getIdentity.mockResolvedValue(admin);
    await setStore({ provider: "openai", model: "gpt-mini" });
    const res = await PUT(req("/api/settings/task-models", "PUT", { purpose: "fileFormat", model: null }));
    expect(res.status).toBe(200);
    expect(await stored()).toBeNull();
  });

  it("rejects an unknown task", async () => {
    const { PUT } = await import("@/app/api/settings/task-models/route");
    getIdentity.mockResolvedValue(admin);
    expect((await PUT(req("/api/settings/task-models", "PUT", { purpose: "nope", model: "x" }))).status).toBe(422);
  });
});

describe("/api/files/format", () => {
  const csv = "```file:data.csv\na,b\n1,2\n```";

  it("returns 404 and calls no model when no helper is set", async () => {
    const { POST } = await import("@/app/api/files/format/route");
    getIdentity.mockResolvedValue(member);
    const res = await POST(req("/api/files/format", "POST", { text: "some reply", ext: "csv" }));
    expect(res.status).toBe(404);
    expect(streamChat).not.toHaveBeenCalled();
  });

  it("needs a signed-in caller", async () => {
    const { POST } = await import("@/app/api/files/format/route");
    getIdentity.mockRejectedValue(new IdentityError("Sign in required.", 401));
    const res = await POST(req("/api/files/format", "POST", { text: "x" }));
    expect(res.status).toBe(401);
    expect(streamChat).not.toHaveBeenCalled();
  });

  it("runs only the approved model, locked to its provider, and returns the file block", async () => {
    const { POST } = await import("@/app/api/files/format/route");
    getIdentity.mockResolvedValue(member);
    await setStore({ provider: "openai", model: "gpt-mini" });
    streamChat.mockImplementation(async function* () {
      yield "Here is your file.\n\n";
      yield csv;
    });
    const res = await POST(req("/api/files/format", "POST", { text: "a table of numbers", ext: "csv" }));
    expect(res.status).toBe(200);
    expect((await res.json()).content).toContain("file:data.csv");
    const opts = streamChat.mock.calls[0][0];
    expect(opts).toMatchObject({ model: "gpt-mini", provider: "openai", lockProvider: true });
  });

  it("sends the model text with card numbers already replaced", async () => {
    const { POST } = await import("@/app/api/files/format/route");
    getIdentity.mockResolvedValue(member);
    await setStore({ provider: "openai", model: "gpt-mini" });
    streamChat.mockImplementation(async function* () {
      yield csv;
    });
    await POST(req("/api/files/format", "POST", { text: "card 4111 1111 1111 1111 in the list", ext: "csv" }));
    const sent = JSON.stringify(streamChat.mock.calls[0][0].messages);
    expect(sent).not.toContain("4111 1111 1111 1111");
  });

  it("returns 422 when the helper's answer has no file block", async () => {
    const { POST } = await import("@/app/api/files/format/route");
    getIdentity.mockResolvedValue(member);
    await setStore({ provider: "openai", model: "gpt-mini" });
    streamChat.mockImplementation(async function* () {
      yield "Sorry, I cannot do that.";
    });
    const res = await POST(req("/api/files/format", "POST", { text: "hello", ext: "csv" }));
    expect(res.status).toBe(422);
  });

  it("does not call the model when the vendor consent is missing", async () => {
    const { POST } = await import("@/app/api/files/format/route");
    getIdentity.mockResolvedValue(member);
    await setStore({ provider: "openai", model: "gpt-mini" });
    consent.externalRiskAckAt = null;
    const res = await POST(req("/api/files/format", "POST", { text: "hello", ext: "csv" }));
    expect(res.status).toBe(422);
    expect(streamChat).not.toHaveBeenCalled();
  });

  it("refuses very long text and rate-limits a burst", async () => {
    const { POST } = await import("@/app/api/files/format/route");
    getIdentity.mockResolvedValue(member);
    expect((await POST(req("/api/files/format", "POST", { text: "x".repeat(40_001) }))).status).toBe(413);
    let last = 0;
    for (let i = 0; i < 25; i++) last = (await POST(req("/api/files/format", "POST", { text: "hi" }))).status;
    expect(last).toBe(429);
  });
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));
