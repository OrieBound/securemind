/**
 * Authorization boundary tests.
 *
 * These assert that a route's database query is always scoped by the
 * server-derived userId, and nothing a caller puts in the query string or body
 * can widen or change that scope.
 *
 * The Prisma client is mocked, so these run without a database.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const workspace = {
  findFirst:  vi.fn(),
  findMany:   vi.fn(),
  findUnique: vi.fn(),
  create:     vi.fn(),
  update:     vi.fn(),
  delete:     vi.fn(),
  count:      vi.fn(),
};
const session       = { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn() };
const message       = { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn(), create: vi.fn() };
const workspaceFact = { findMany: vi.fn() };
const securityEvent = { findMany: vi.fn(), createMany: vi.fn() };
const inferenceEvent = { findMany: vi.fn(), create: vi.fn() };

vi.mock("@/lib/db", () => ({
  db: { workspace, session, message, workspaceFact, securityEvent, inferenceEvent },
}));
vi.mock("@/lib/memory", () => ({
  storeMemoryFragment: vi.fn(),
  retrieveSemanticMemory: vi.fn(),
}));

const SERVER_USER = "local";
const ATTACKER    = "victim-user-id";

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/workspaces/:id", () => {
  it("scopes the lookup to the server-derived user", async () => {
    const { GET } = await import("@/app/api/workspaces/[id]/route");
    workspace.findFirst.mockResolvedValue({ id: "w1", userId: SERVER_USER, facts: [] });

    await GET(new NextRequest("http://localhost/api/workspaces/w1"), params("w1"));

    expect(workspace.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "w1", userId: SERVER_USER } }),
    );
  });

  it("ignores a userId supplied in the query string", async () => {
    const { GET } = await import("@/app/api/workspaces/[id]/route");
    workspace.findFirst.mockResolvedValue({ id: "w1", userId: SERVER_USER, facts: [] });

    await GET(
      new NextRequest(`http://localhost/api/workspaces/w1?userId=${ATTACKER}`),
      params("w1"),
    );

    const where = workspace.findFirst.mock.calls[0][0].where;
    expect(where.userId).toBe(SERVER_USER);
    expect(where.userId).not.toBe(ATTACKER);
  });

  it("returns 404 for a workspace owned by someone else", async () => {
    const { GET } = await import("@/app/api/workspaces/[id]/route");
    workspace.findFirst.mockResolvedValue(null);

    const res = await GET(new NextRequest("http://localhost/api/workspaces/other"), params("other"));

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: "Workspace not found" });
  });

  it("never falls back to findUnique on the bare id", async () => {
    const { GET } = await import("@/app/api/workspaces/[id]/route");
    workspace.findFirst.mockResolvedValue(null);

    await GET(new NextRequest("http://localhost/api/workspaces/w1"), params("w1"));

    expect(workspace.findUnique).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/workspaces/:id", () => {
  it("refuses to update a workspace the caller does not own", async () => {
    const { PATCH } = await import("@/app/api/workspaces/[id]/route");
    workspace.findFirst.mockResolvedValue(null);

    const req = new NextRequest("http://localhost/api/workspaces/other", {
      method: "PATCH",
      body: JSON.stringify({ name: "hijacked", userId: ATTACKER }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await PATCH(req, params("other"));

    expect(res.status).toBe(404);
    expect(workspace.update).not.toHaveBeenCalled();
  });

  it("scopes the ownership check to the server-derived user", async () => {
    const { PATCH } = await import("@/app/api/workspaces/[id]/route");
    workspace.findFirst.mockResolvedValue({
      id: "w1", userId: SERVER_USER, name: "Aegis", context: null, description: null,
    });
    workspace.update.mockResolvedValue({ id: "w1" });

    const req = new NextRequest("http://localhost/api/workspaces/w1", {
      method: "PATCH",
      body: JSON.stringify({ name: "Renamed" }),
      headers: { "Content-Type": "application/json" },
    });
    await PATCH(req, params("w1"));

    expect(workspace.findFirst).toHaveBeenCalledWith({
      where: { id: "w1", userId: SERVER_USER },
      select: { id: true },
    });
    expect(workspace.update).toHaveBeenCalled();
  });
});

describe("DELETE /api/workspaces/:id", () => {
  it("refuses to delete a workspace the caller does not own", async () => {
    const { DELETE } = await import("@/app/api/workspaces/[id]/route");
    workspace.findFirst.mockResolvedValue(null);

    const res = await DELETE(
      new NextRequest("http://localhost/api/workspaces/other", { method: "DELETE" }),
      params("other"),
    );

    expect(res.status).toBe(404);
    expect(workspace.delete).not.toHaveBeenCalled();
  });

  it("counts remaining workspaces within the caller's own tenancy", async () => {
    const { DELETE } = await import("@/app/api/workspaces/[id]/route");
    workspace.findFirst.mockResolvedValue({ id: "w1" });
    workspace.count.mockResolvedValue(3);
    workspace.delete.mockResolvedValue({ id: "w1" });

    await DELETE(
      new NextRequest("http://localhost/api/workspaces/w1", { method: "DELETE" }),
      params("w1"),
    );

    expect(workspace.count).toHaveBeenCalledWith({ where: { userId: SERVER_USER } });
  });
});

describe("GET /api/workspaces", () => {
  it("ignores a userId supplied in the query string", async () => {
    const { GET } = await import("@/app/api/workspaces/route");
    workspace.findMany.mockResolvedValue([{ id: "w1" }]);

    await GET(new NextRequest(`http://localhost/api/workspaces?userId=${ATTACKER}`));

    expect(workspace.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: SERVER_USER } }),
    );
  });
});

describe("POST /api/workspaces", () => {
  it("ignores a userId supplied in the body", async () => {
    const { POST } = await import("@/app/api/workspaces/route");
    workspace.create.mockResolvedValue({ id: "w2" });

    const req = new NextRequest("http://localhost/api/workspaces", {
      method: "POST",
      body: JSON.stringify({ name: "Mine", userId: ATTACKER }),
      headers: { "Content-Type": "application/json" },
    });
    await POST(req);

    expect(workspace.create.mock.calls[0][0].data.userId).toBe(SERVER_USER);
  });
});

describe("GET /api/session", () => {
  it("rejects a workspaceId the caller does not own before reading anything", async () => {
    const { GET } = await import("@/app/api/session/route");
    workspace.findFirst.mockResolvedValue(null);

    const res = await GET(new NextRequest("http://localhost/api/session?workspaceId=other"));

    expect(res.status).toBe(404);
    expect(message.findFirst).not.toHaveBeenCalled();
    expect(workspaceFact.findMany).not.toHaveBeenCalled();
  });

  it("ignores a userId supplied in the query string", async () => {
    const { GET } = await import("@/app/api/session/route");
    workspace.findFirst.mockResolvedValue(null);

    await GET(new NextRequest(`http://localhost/api/session?workspaceId=w1&userId=${ATTACKER}`));

    expect(workspace.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "w1", userId: SERVER_USER } }),
    );
  });
});

describe("GET /api/memory", () => {
  it("rejects a workspaceId the caller does not own before reading facts", async () => {
    const { GET } = await import("@/app/api/memory/route");
    workspace.findFirst.mockResolvedValue(null);

    const res = await GET(new NextRequest("http://localhost/api/memory?workspaceId=other"));

    expect(res.status).toBe(404);
    expect(workspaceFact.findMany).not.toHaveBeenCalled();
  });
});

describe("GET /api/analytics/security", () => {
  it("returns 404 when workspaceId is not owned", async () => {
    const { GET } = await import("@/app/api/analytics/security/route");
    workspace.findFirst.mockResolvedValue(null);

    const res = await GET(
      new NextRequest("http://localhost/api/analytics/security?workspaceId=other"),
    );

    expect(res.status).toBe(404);
    expect(securityEvent.findMany).not.toHaveBeenCalled();
  });

  it("scopes owned-workspace lookups to the server-derived user", async () => {
    const { GET } = await import("@/app/api/analytics/security/route");
    workspace.findFirst.mockResolvedValue({ id: "w1" });
    securityEvent.findMany.mockResolvedValue([]);
    workspace.findMany.mockResolvedValue([{ id: "w1", name: "Aegis" }]);

    await GET(
      new NextRequest("http://localhost/api/analytics/security?workspaceId=w1&userId=attacker"),
    );

    expect(workspace.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "w1", userId: SERVER_USER } }),
    );
    expect(securityEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: SERVER_USER, workspaceId: "w1" }),
      }),
    );
  });
});

describe("POST /api/analytics/security", () => {
  it("rejects payloads that try to include raw values", async () => {
    const { POST } = await import("@/app/api/analytics/security/route");
    const req = new NextRequest("http://localhost/api/analytics/security", {
      method: "POST",
      body: JSON.stringify({
        events: [{ category: "email", source: "investigate", outcome: "redacted", value: "a@b.com" }],
      }),
      headers: { "Content-Type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(422);
    expect(securityEvent.createMany).not.toHaveBeenCalled();
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
    session.findFirst.mockResolvedValue({ workspaceId: "w1", userId: SERVER_USER });
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
