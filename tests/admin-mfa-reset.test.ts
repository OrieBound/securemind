/**
 * Admin reset of someone's two-step verification (a lost phone): admins only, the Super Admin
 * account is protected, and the local sign-in without codes says so plainly.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  identity: { userId: "admin-1", email: "admin@example.com", role: "admin", authenticated: true, groups: ["Admin"] } as Record<string, unknown>,
  target: { username: "member@example.com", email: "member@example.com", role: "member", isOwner: false } as Record<string, unknown> | null,
  reset: vi.fn(),
}));

vi.mock("@/lib/user-profile", () => ({
  setProfileStatus: vi.fn(),
  setUserMonthlyCostCap: vi.fn(),
}));
vi.mock("@/lib/cost-cap", () => ({
  getUserMonthSpendUsd: vi.fn(async () => 0),
  parseMonthlyCostCapInput: vi.fn(),
}));
vi.mock("@/lib/mail", () => ({
  isMailConfigured: () => false,
  sendAdminPasswordSetEmail: vi.fn(),
}));
vi.mock("@/lib/identity", async orig => ({
  ...(await orig<typeof import("@/lib/identity")>()),
  getIdentity: vi.fn(async () => state.identity),
}));
vi.mock("@/lib/cognito-admin", async orig => ({
  ...(await orig<typeof import("@/lib/cognito-admin")>()),
  cognitoAdminAvailable: () => true,
  findDirectoryUser: vi.fn(async () => state.target),
  adminResetDirectoryUserMfa: (...a: unknown[]) => state.reset(...a),
}));

import { CognitoAdminError } from "@/lib/cognito-admin";
import { PATCH } from "@/app/api/admin/users/[username]/route";

function patch(body: unknown, username = "member@example.com") {
  return PATCH(
    new NextRequest(`http://localhost/api/admin/users/${username}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ username }) },
  );
}

beforeEach(() => {
  state.identity = { userId: "admin-1", email: "admin@example.com", role: "admin", authenticated: true, groups: ["Admin"] };
  state.target = { username: "member@example.com", email: "member@example.com", role: "member", isOwner: false };
  state.reset.mockReset();
  state.reset.mockResolvedValue(undefined);
});

describe("PATCH /api/admin/users/:username with resetMfa", () => {
  it("lets an admin turn off a member's two-step verification", async () => {
    const res = await patch({ resetMfa: true });
    expect(res.status).toBe(200);
    expect(state.reset).toHaveBeenCalledTimes(1);
    expect(state.reset.mock.calls[0][0]).toBe("member@example.com");
    expect(state.reset.mock.calls[0][1]).toMatchObject({ actorRole: "admin", actorUserId: "admin-1" });
    expect(((await res.json()) as { message: string }).message).toMatch(/set it up again/);
  });

  it("refuses a member, and does nothing", async () => {
    state.identity = { ...state.identity, role: "member", groups: ["Member"] };
    const res = await patch({ resetMfa: true });
    expect(res.status).toBeGreaterThanOrEqual(401);
    expect(res.status).toBeLessThanOrEqual(403);
    expect(state.reset).not.toHaveBeenCalled();
  });

  it("protects the Super Admin from anyone but the Super Admin", async () => {
    state.target = { username: "owner@example.com", email: "owner@example.com", role: "super_admin", isOwner: true };
    const res = await patch({ resetMfa: true }, "owner@example.com");
    expect(res.status).toBe(403);
    expect(state.reset).not.toHaveBeenCalled();
  });

  it("lets the Super Admin reset their own", async () => {
    state.identity = { ...state.identity, userId: "owner-1", role: "super_admin", groups: ["Owner"] };
    state.target = { username: "owner@example.com", email: "owner@example.com", role: "super_admin", isOwner: true };
    expect((await patch({ resetMfa: true }, "owner@example.com")).status).toBe(200);
    expect(state.reset).toHaveBeenCalledTimes(1);
  });

  it("returns 404 for a user who does not exist", async () => {
    state.target = null;
    expect((await patch({ resetMfa: true }, "nobody@example.com")).status).toBe(404);
    expect(state.reset).not.toHaveBeenCalled();
  });

  it("says plainly when the local sign-in cannot do this", async () => {
    state.reset.mockRejectedValue(new CognitoAdminError("Two-step verification is not available with the local sign-in used by Docker.", 501));
    const res = await patch({ resetMfa: true });
    expect(res.status).toBe(501);
    expect(((await res.json()) as { error: string }).error).toMatch(/not available/);
  });
});
