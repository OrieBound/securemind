/**
 * Admin-only ?asUser= subject override for analytics GET routes.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getIdentity = vi.fn();

const workspace = {
  findFirst: vi.fn(),
  findMany: vi.fn(),
};
const securityEvent = {
  findMany: vi.fn(),
  findFirst: vi.fn(),
};
const inferenceEvent = {
  findMany: vi.fn(),
  findFirst: vi.fn(),
};
const userProfile = {
  findUnique: vi.fn(),
};
const document = {
  findMany: vi.fn(),
};

vi.mock("@/lib/identity", async () => {
  const actual = await vi.importActual<typeof import("@/lib/identity")>("@/lib/identity");
  return {
    ...actual,
    getIdentity: (...args: unknown[]) => getIdentity(...args),
  };
});

vi.mock("@/lib/db", () => ({
  db: { workspace, securityEvent, inferenceEvent, userProfile, document },
}));

beforeEach(() => {
  vi.clearAllMocks();
  workspace.findMany.mockResolvedValue([]);
  workspace.findFirst.mockResolvedValue(null);
  securityEvent.findMany.mockResolvedValue([]);
  securityEvent.findFirst.mockResolvedValue(null);
  inferenceEvent.findMany.mockResolvedValue([]);
  inferenceEvent.findFirst.mockResolvedValue(null);
  userProfile.findUnique.mockResolvedValue(null);
  document.findMany.mockResolvedValue([]);
});

describe("GET /api/analytics/security ?asUser=", () => {
  it("rejects members who pass asUser with 403", async () => {
    getIdentity.mockResolvedValue({
      userId: "member-1",
      authenticated: true,
      role: "member",
      groups: ["Member"],
    });

    const { GET } = await import("@/app/api/analytics/security/route");
    const res = await GET(
      new NextRequest("http://localhost/api/analytics/security?asUser=other-user"),
    );

    expect(res.status).toBe(403);
    expect(securityEvent.findMany).not.toHaveBeenCalled();
  });

  it("returns 404 when admin scopes to an unknown subject", async () => {
    getIdentity.mockResolvedValue({
      userId: "admin-1",
      authenticated: true,
      role: "admin",
      groups: ["Admin"],
    });
    userProfile.findUnique.mockResolvedValue(null);
    workspace.findFirst.mockResolvedValue(null);
    inferenceEvent.findFirst.mockResolvedValue(null);
    securityEvent.findFirst.mockResolvedValue(null);

    const { GET } = await import("@/app/api/analytics/security/route");
    const res = await GET(
      new NextRequest("http://localhost/api/analytics/security?asUser=ghost-user"),
    );

    expect(res.status).toBe(404);
    expect(securityEvent.findMany).not.toHaveBeenCalled();
  });

  it("scopes summary queries to the subject for admins", async () => {
    getIdentity.mockResolvedValue({
      userId: "admin-1",
      authenticated: true,
      role: "admin",
      groups: ["Admin"],
    });
    userProfile.findUnique.mockResolvedValue({ userId: "member-sub", email: "m@x.com" });
    workspace.findFirst.mockResolvedValue({ id: "w-member" });
    securityEvent.findMany.mockResolvedValue([]);
    workspace.findMany.mockResolvedValue([{ id: "w-member", name: "Ops" }]);

    const { GET } = await import("@/app/api/analytics/security/route");
    await GET(
      new NextRequest(
        "http://localhost/api/analytics/security?asUser=member-sub&workspaceId=w-member",
      ),
    );

    expect(workspace.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "w-member", userId: "member-sub" } }),
    );
    expect(securityEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: "member-sub", workspaceId: "w-member" }),
      }),
    );
  });

  it("ignores legacy userId query for members (still self-scoped)", async () => {
    getIdentity.mockResolvedValue({
      userId: "member-1",
      authenticated: true,
      role: "member",
      groups: ["Member"],
    });
    workspace.findFirst.mockResolvedValue({ id: "w1" });
    securityEvent.findMany.mockResolvedValue([]);
    workspace.findMany.mockResolvedValue([{ id: "w1", name: "Mine" }]);

    const { GET } = await import("@/app/api/analytics/security/route");
    await GET(
      new NextRequest(
        "http://localhost/api/analytics/security?workspaceId=w1&userId=attacker",
      ),
    );

    expect(workspace.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "w1", userId: "member-1" } }),
    );
    expect(securityEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: "member-1" }),
      }),
    );
  });
});

describe("GET /api/admin/insights-subject", () => {
  it("rejects members", async () => {
    getIdentity.mockResolvedValue({
      userId: "member-1",
      authenticated: true,
      role: "member",
      groups: ["Member"],
    });
    const { GET } = await import("@/app/api/admin/insights-subject/route");
    const res = await GET(
      new NextRequest("http://localhost/api/admin/insights-subject?userId=x"),
    );
    expect(res.status).toBe(403);
  });

  it("returns workspaces for a known subject", async () => {
    getIdentity.mockResolvedValue({
      userId: "admin-1",
      authenticated: true,
      role: "admin",
      groups: ["Admin"],
    });
    userProfile.findUnique.mockResolvedValue({
      userId: "member-sub",
      email: "demo@securemind.local",
      displayName: "Demo",
    });
    workspace.findFirst.mockResolvedValue({ id: "w1" });
    workspace.findMany.mockResolvedValue([{ id: "w1", name: "Aegis" }]);

    const { GET } = await import("@/app/api/admin/insights-subject/route");
    const res = await GET(
      new NextRequest("http://localhost/api/admin/insights-subject?userId=member-sub"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.label).toBe("Demo");
    expect(body.workspaces).toEqual([{ id: "w1", name: "Aegis" }]);
  });
});
