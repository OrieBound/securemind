/**
 * /api/summarize takes sessionId and workspaceId from the request body. On the Postgres path it
 * must only write a summary or facts when that session belongs to the signed-in user, otherwise
 * one account could overwrite another's memory by guessing ids.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const session = { findFirst: vi.fn() };
const sessionSummary = { upsert: vi.fn().mockResolvedValue({}) };
const workspaceFact = { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn().mockResolvedValue({}) };

vi.mock("@/lib/db", () => ({ db: { session, sessionSummary, workspaceFact } }));
vi.mock("@/lib/identity", () => ({ getIdentity: async () => ({ userId: "user-a" }) }));
vi.mock("@/lib/workspaces/store", () => ({ usesHostedAppStore: () => false }));
vi.mock("@/lib/workspaces/hosted-dynamo", () => ({ hostedAppStore: () => ({}) }));
vi.mock("@/lib/models/router", () => ({ routeModel: () => ({ model: "m", provider: "groq" }) }));
vi.mock("@/lib/models/groq", () => ({
  streamGroqChat: async function* () {
    yield JSON.stringify({ summary: "s", facts: { Name: "Ada" } });
  },
}));
vi.mock("@/lib/models/ollama", () => ({ probeOllama: vi.fn(), streamOllamaChat: vi.fn() }));
vi.mock("@/lib/models/local-recommendations", () => ({ pickInstalledChatModel: vi.fn() }));
vi.mock("@/lib/models/provider", () => ({ streamChat: vi.fn() }));
vi.mock("@/lib/models/catalog", () => ({ getModelCatalogCached: vi.fn() }));
vi.mock("@/lib/models/background-model", () => ({ pickBackgroundVendorModel: vi.fn() }));
vi.mock("@/lib/instance-config", () => ({ getVendorConsentFlags: vi.fn().mockResolvedValue({}) }));

function request() {
  return new NextRequest("http://localhost/api/summarize", {
    method: "POST",
    body: JSON.stringify({
      messages: [{ role: "user", content: "My name is Ada" }],
      sessionId: "s1",
      workspaceId: "w1",
      purpose: "facts",
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/summarize persistence", () => {
  it("writes nothing when the session is not the caller's", async () => {
    const { POST } = await import("@/app/api/summarize/route");
    session.findFirst.mockResolvedValue(null);

    const res = await POST(request());
    await new Promise(r => setTimeout(r, 0));

    expect(res.status).toBe(200);
    expect(session.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "s1", userId: "user-a", workspaceId: "w1" } }),
    );
    expect(sessionSummary.upsert).not.toHaveBeenCalled();
    expect(workspaceFact.upsert).not.toHaveBeenCalled();
  });

  it("writes the summary and facts when the session belongs to the caller", async () => {
    const { POST } = await import("@/app/api/summarize/route");
    session.findFirst.mockResolvedValue({ id: "s1" });

    await POST(request());
    await new Promise(r => setTimeout(r, 0));

    expect(sessionSummary.upsert).toHaveBeenCalled();
    expect(workspaceFact.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ workspaceId: "w1", userId: "user-a" }) }),
    );
  });
});
