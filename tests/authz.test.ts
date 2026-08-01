/**
 * Authorization boundary tests.
 *
 * These assert the property that matters: a route's database query is always
 * scoped by the server-derived userId, and nothing a caller puts in the query
 * string or body can widen or change that scope.
 *
 * The Prisma client is mocked, so these run without a database.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const agent = {
  findFirst:  vi.fn(),
  findMany:   vi.fn(),
  findUnique: vi.fn(),
  create:     vi.fn(),
  update:     vi.fn(),
  delete:     vi.fn(),
  count:      vi.fn(),
};
const session   = { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() };
const message   = { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn(), create: vi.fn() };
const agentFact = { findMany: vi.fn() };

vi.mock("@/lib/db", () => ({
  db: { agent, session, message, agentFact },
}));
vi.mock("@/lib/memory", () => ({
  storeMemoryFragment: vi.fn(),
  retrieveSemanticMemory: vi.fn(),
}));

/** The identity every route must use, regardless of what the caller sends. */
const SERVER_USER = "local";
const ATTACKER    = "victim-user-id";

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/agents/:id", () => {
  it("scopes the lookup to the server-derived user", async () => {
    const { GET } = await import("@/app/api/agents/[id]/route");
    agent.findFirst.mockResolvedValue({ id: "a1", userId: SERVER_USER, facts: [] });

    await GET(new NextRequest("http://localhost/api/agents/a1"), params("a1"));

    expect(agent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "a1", userId: SERVER_USER } }),
    );
  });

  it("ignores a userId supplied in the query string", async () => {
    const { GET } = await import("@/app/api/agents/[id]/route");
    agent.findFirst.mockResolvedValue({ id: "a1", userId: SERVER_USER, facts: [] });

    await GET(
      new NextRequest(`http://localhost/api/agents/a1?userId=${ATTACKER}`),
      params("a1"),
    );

    const where = agent.findFirst.mock.calls[0][0].where;
    expect(where.userId).toBe(SERVER_USER);
    expect(where.userId).not.toBe(ATTACKER);
  });

  it("returns 404 for an agent owned by someone else", async () => {
    const { GET } = await import("@/app/api/agents/[id]/route");
    agent.findFirst.mockResolvedValue(null);

    const res = await GET(new NextRequest("http://localhost/api/agents/other"), params("other"));

    expect(res.status).toBe(404);
    // Must not distinguish "exists but not yours" from "does not exist".
    await expect(res.json()).resolves.toEqual({ error: "Agent not found" });
  });

  it("never falls back to findUnique on the bare id", async () => {
    const { GET } = await import("@/app/api/agents/[id]/route");
    agent.findFirst.mockResolvedValue(null);

    await GET(new NextRequest("http://localhost/api/agents/a1"), params("a1"));

    expect(agent.findUnique).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/agents/:id", () => {
  it("refuses to update an agent the caller does not own", async () => {
    const { PATCH } = await import("@/app/api/agents/[id]/route");
    agent.findFirst.mockResolvedValue(null);

    const req = new NextRequest("http://localhost/api/agents/other", {
      method: "PATCH",
      body: JSON.stringify({ name: "hijacked", userId: ATTACKER }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req, params("other"));

    expect(res.status).toBe(404);
    expect(agent.update).not.toHaveBeenCalled();
  });

  it("scopes the ownership check to the server-derived user", async () => {
    const { PATCH } = await import("@/app/api/agents/[id]/route");
    agent.findFirst.mockResolvedValue({ id: "a1", userId: SERVER_USER, personality: "", name: "Sage" });
    agent.update.mockResolvedValue({ id: "a1" });

    const req = new NextRequest("http://localhost/api/agents/a1", {
      method: "PATCH",
      body: JSON.stringify({ name: "Renamed" }),
      headers: { "Content-Type": "application/json" },
    });
    await PATCH(req, params("a1"));

    expect(agent.findFirst).toHaveBeenCalledWith({ where: { id: "a1", userId: SERVER_USER } });
    expect(agent.update).toHaveBeenCalled();
  });
});

describe("DELETE /api/agents/:id", () => {
  it("refuses to delete an agent the caller does not own", async () => {
    const { DELETE } = await import("@/app/api/agents/[id]/route");
    agent.findFirst.mockResolvedValue(null);

    const res = await DELETE(new NextRequest("http://localhost/api/agents/other", { method: "DELETE" }), params("other"));

    expect(res.status).toBe(404);
    expect(agent.delete).not.toHaveBeenCalled();
  });

  it("counts remaining agents within the caller's own tenancy", async () => {
    const { DELETE } = await import("@/app/api/agents/[id]/route");
    agent.findFirst.mockResolvedValue({ id: "a1" });
    agent.count.mockResolvedValue(3);
    agent.delete.mockResolvedValue({ id: "a1" });

    await DELETE(new NextRequest("http://localhost/api/agents/a1", { method: "DELETE" }), params("a1"));

    expect(agent.count).toHaveBeenCalledWith({ where: { userId: SERVER_USER } });
  });
});

describe("GET /api/agents", () => {
  it("ignores a userId supplied in the query string", async () => {
    const { GET } = await import("@/app/api/agents/route");
    agent.findMany.mockResolvedValue([{ id: "a1" }]);

    await GET(new NextRequest(`http://localhost/api/agents?userId=${ATTACKER}`));

    expect(agent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: SERVER_USER } }),
    );
  });
});

describe("POST /api/agents", () => {
  it("ignores a userId supplied in the body", async () => {
    const { POST } = await import("@/app/api/agents/route");
    agent.create.mockResolvedValue({ id: "a2" });

    const req = new NextRequest("http://localhost/api/agents", {
      method: "POST",
      body: JSON.stringify({ name: "Mine", userId: ATTACKER }),
      headers: { "Content-Type": "application/json" },
    });
    await POST(req);

    expect(agent.create.mock.calls[0][0].data.userId).toBe(SERVER_USER);
  });
});

describe("GET /api/session", () => {
  it("rejects an agentId the caller does not own before reading anything", async () => {
    const { GET } = await import("@/app/api/session/route");
    agent.findFirst.mockResolvedValue(null);

    const res = await GET(new NextRequest("http://localhost/api/session?agentId=other"));

    expect(res.status).toBe(404);
    expect(message.findFirst).not.toHaveBeenCalled();
    expect(agentFact.findMany).not.toHaveBeenCalled();
  });

  it("ignores a userId supplied in the query string", async () => {
    const { GET } = await import("@/app/api/session/route");
    agent.findFirst.mockResolvedValue(null);

    await GET(new NextRequest(`http://localhost/api/session?agentId=a1&userId=${ATTACKER}`));

    expect(agent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "a1", userId: SERVER_USER } }),
    );
  });
});

describe("GET /api/memory", () => {
  it("rejects an agentId the caller does not own before reading facts", async () => {
    const { GET } = await import("@/app/api/memory/route");
    agent.findFirst.mockResolvedValue(null);

    const res = await GET(new NextRequest("http://localhost/api/memory?agentId=other"));

    expect(res.status).toBe(404);
    expect(agentFact.findMany).not.toHaveBeenCalled();
  });
});

describe("POST /api/messages", () => {
  it("refuses to write to a session the caller does not own", async () => {
    const { POST } = await import("@/app/api/messages/route");
    session.findFirst.mockResolvedValue(null);

    const req = new NextRequest("http://localhost/api/messages", {
      method: "POST",
      body: JSON.stringify({ sessionId: "someone-elses", role: "user", content: "hello there" }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);

    expect(res.status).toBe(404);
    expect(message.create).not.toHaveBeenCalled();
  });

  it("scopes the session lookup to the server-derived user", async () => {
    const { POST } = await import("@/app/api/messages/route");
    session.findFirst.mockResolvedValue({ agentId: "a1", userId: SERVER_USER });
    message.create.mockResolvedValue({ id: "m1" });
    session.update.mockResolvedValue({});

    const req = new NextRequest("http://localhost/api/messages", {
      method: "POST",
      body: JSON.stringify({ sessionId: "s1", role: "user", content: "hello there" }),
      headers: { "Content-Type": "application/json" },
    });
    await POST(req);

    expect(session.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "s1", userId: SERVER_USER } }),
    );
  });
});
