/**
 * The server gate for the non-exemptible categories (card numbers, SSNs, secrets) also covers text
 * that is saved or sent to a model outside a chat turn: saved messages, workspace context and
 * corrected memory facts. A crafted request that skips the browser must not store those values.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const CARD = "4111 1111 1111 1111";
const SSN = "123-45-6789";

const appendMessage = vi.fn(async (..._a: unknown[]) => ({ id: "m1" }));
const updateWorkspace = vi.fn(async (..._a: unknown[]) => ({ id: "w1" }));
const patchFact = vi.fn(async (..._a: unknown[]) => ({ id: "f1" }));

vi.mock("@/lib/identity", () => ({
  getIdentity: async () => ({ userId: "user-a", authenticated: true, role: "member", groups: [] }),
  identityErrorResponse: () => null,
}));
vi.mock("@/lib/workspaces/store", () => ({
  appendMessage: (...a: unknown[]) => appendMessage(...a),
  updateWorkspace: (...a: unknown[]) => updateWorkspace(...a),
  usesHostedAppStore: () => false,
  getWorkspaceWithFacts: vi.fn(),
  deleteWorkspace: vi.fn(),
}));
vi.mock("@/lib/storage/postgres", () => ({ postgresMemory: { patchFact: (...a: unknown[]) => patchFact(...a) } }));

const json = (url: string, method: string, body: unknown) =>
  new NextRequest(url, { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } });

beforeEach(() => vi.clearAllMocks());

describe("POST /api/messages", () => {
  it("replaces a card number and an SSN before saving", async () => {
    const { POST } = await import("@/app/api/messages/route");
    const res = await POST(json("http://x/api/messages", "POST", { sessionId: "s1", role: "user", content: `card ${CARD} ssn ${SSN}` }));
    expect(res.status).toBe(200);
    const saved = String(appendMessage.mock.calls[0]![3]);
    expect(saved).not.toContain(CARD);
    expect(saved).not.toContain(SSN);
  });

  it("leaves ordinary text alone", async () => {
    const { POST } = await import("@/app/api/messages/route");
    await POST(json("http://x/api/messages", "POST", { sessionId: "s1", role: "assistant", content: "Order 1234 ships Tuesday." }));
    expect(appendMessage.mock.calls[0]![3]).toBe("Order 1234 ships Tuesday.");
  });

  it("accepts only user and assistant roles", async () => {
    const { POST } = await import("@/app/api/messages/route");
    for (const role of ["system", "tool", "", 7]) {
      const res = await POST(json("http://x/api/messages", "POST", { sessionId: "s1", role, content: "hi" }));
      expect(res.status, String(role)).toBe(422);
    }
    expect(appendMessage).not.toHaveBeenCalled();
  });

  it("refuses a message over the size limit", async () => {
    const { POST } = await import("@/app/api/messages/route");
    const res = await POST(json("http://x/api/messages", "POST", { sessionId: "s1", role: "user", content: "a".repeat(200_001) }));
    expect(res.status).toBe(413);
    expect(appendMessage).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/workspaces/:id", () => {
  const params = { params: Promise.resolve({ id: "w1" }) };

  it("replaces non-exemptible values in workspace context", async () => {
    const { PATCH } = await import("@/app/api/workspaces/[id]/route");
    await PATCH(json("http://x/api/workspaces/w1", "PATCH", { context: `Billing card ${CARD}` }), params);
    const data = updateWorkspace.mock.calls[0]![2] as { context: string };
    expect(data.context).not.toContain(CARD);
  });

  it("returns a generic error instead of the database message", async () => {
    updateWorkspace.mockRejectedValueOnce(new Error("Invalid value 'secret stuff' for column"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { PATCH } = await import("@/app/api/workspaces/[id]/route");
    const res = await PATCH(json("http://x/api/workspaces/w1", "PATCH", { name: "Ops" }), params);
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret stuff");
    expect(JSON.stringify(err.mock.calls)).not.toContain("secret stuff");
    err.mockRestore();
  });
});

describe("PATCH /api/memory/facts/:id", () => {
  it("replaces non-exemptible values in a corrected fact", async () => {
    const { PATCH } = await import("@/app/api/memory/facts/[id]/route");
    await PATCH(
      json("http://x/api/memory/facts/f1?workspaceId=w1", "PATCH", { value: `SSN is ${SSN}` }),
      { params: Promise.resolve({ id: "f1" }) },
    );
    const patch = patchFact.mock.calls[0]![3] as { value: string };
    expect(patch.value).not.toContain(SSN);
  });
});
