import { describe, expect, it, vi } from "vitest";

const identity = vi.hoisted(() => ({ role: "member" as string }));
vi.mock("@/lib/identity", async () => {
  const real = await vi.importActual<typeof import("@/lib/identity")>("@/lib/identity");
  return {
    ...real,
    getIdentity: async () => ({ userId: "u1", authenticated: true, role: identity.role, groups: [] }),
  };
});
vi.mock("@/lib/audit-log", () => ({ listAudit: async () => [{ id: "1", action: "user.create" }] }));

import { GET } from "@/app/api/admin/audit/route";
import { NextRequest } from "next/server";

describe("GET /api/admin/audit", () => {
  it("is forbidden to members", async () => {
    identity.role = "member";
    expect((await GET(new NextRequest("http://x/api/admin/audit"))).status).toBe(403);
  });
  it("returns events to admins", async () => {
    identity.role = "admin";
    const res = await GET(new NextRequest("http://x/api/admin/audit"));
    expect(res.status).toBe(200);
    expect((await res.json()).events).toHaveLength(1);
  });
});
