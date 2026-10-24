/**
 * Admin console route authz: members get 403; admins/super admins may proceed.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getIdentity = vi.fn();
const getOrgOverview = vi.fn();
const listDirectoryUsers = vi.fn();
const createDirectoryUser = vi.fn();
const setDirectoryUserRole = vi.fn();
const setDirectoryUserEnabled = vi.fn();
const findDirectoryUser = vi.fn();
const adminResetDirectoryUserPassword = vi.fn();
const adminSetDirectoryUserPassword = vi.fn();
const cognitoAdminAvailable = vi.fn();
const sendWelcomeAddedEmail = vi.fn();
const sendAdminPasswordSetEmail = vi.fn();
const isMailConfigured = vi.fn();
const getDefaultMonthlyCostCapUsd = vi.fn();
const getUserMonthSpendUsd = vi.fn();
const getUsersMonthSpendUsd = vi.fn();
const ensureUserProfile = vi.fn();
const setUserMonthlyCostCap = vi.fn();
const setProfileStatus = vi.fn();

vi.mock("@/lib/identity", async () => {
  const actual = await vi.importActual<typeof import("@/lib/identity")>("@/lib/identity");
  return {
    ...actual,
    getIdentity: (...args: unknown[]) => getIdentity(...args),
  };
});

vi.mock("@/lib/admin/overview", () => ({
  getOrgOverview: (...args: unknown[]) => getOrgOverview(...args),
}));

vi.mock("@/lib/cognito-admin", () => ({
  CognitoAdminError: class CognitoAdminError extends Error {
    status: number;
    constructor(message: string, status = 400) {
      super(message);
      this.status = status;
    }
  },
  cognitoAdminAvailable: (...args: unknown[]) => cognitoAdminAvailable(...args),
  listDirectoryUsers: (...args: unknown[]) => listDirectoryUsers(...args),
  createDirectoryUser: (...args: unknown[]) => createDirectoryUser(...args),
  setDirectoryUserRole: (...args: unknown[]) => setDirectoryUserRole(...args),
  setDirectoryUserEnabled: (...args: unknown[]) => setDirectoryUserEnabled(...args),
  findDirectoryUser: (...args: unknown[]) => findDirectoryUser(...args),
  adminResetDirectoryUserPassword: (...args: unknown[]) => adminResetDirectoryUserPassword(...args),
  adminSetDirectoryUserPassword: (...args: unknown[]) => adminSetDirectoryUserPassword(...args),
}));

vi.mock("@/lib/mail", () => ({
  isMailConfigured: (...args: unknown[]) => isMailConfigured(...args),
  sendWelcomeAddedEmail: (...args: unknown[]) => sendWelcomeAddedEmail(...args),
  sendAdminPasswordSetEmail: (...args: unknown[]) => sendAdminPasswordSetEmail(...args),
  appSignInUrl: () => "http://localhost:3000/",
  appPublicUrl: () => "http://localhost:3000",
}));

vi.mock("@/lib/cost-cap", async () => {
  const actual = await vi.importActual<typeof import("@/lib/cost-cap")>("@/lib/cost-cap");
  return {
    ...actual,
    getDefaultMonthlyCostCapUsd: (...args: unknown[]) => getDefaultMonthlyCostCapUsd(...args),
    getUserMonthSpendUsd: (...args: unknown[]) => getUserMonthSpendUsd(...args),
    getUsersMonthSpendUsd: (...args: unknown[]) => getUsersMonthSpendUsd(...args),
  };
});

vi.mock("@/lib/user-profile", () => ({
  ensureUserProfile: (...args: unknown[]) => ensureUserProfile(...args),
  setUserMonthlyCostCap: (...args: unknown[]) => setUserMonthlyCostCap(...args),
  setProfileStatus: (...args: unknown[]) => setProfileStatus(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  cognitoAdminAvailable.mockReturnValue(true);
  isMailConfigured.mockReturnValue(false);
  sendWelcomeAddedEmail.mockResolvedValue({ sent: false, reason: "not_configured" });
  sendAdminPasswordSetEmail.mockResolvedValue({ sent: false, reason: "not_configured" });
  getDefaultMonthlyCostCapUsd.mockResolvedValue(10);
  getUserMonthSpendUsd.mockResolvedValue(0);
  getUsersMonthSpendUsd.mockResolvedValue(new Map());
  ensureUserProfile.mockResolvedValue({ monthlyCostCapUsd: null, status: "active" });
  setUserMonthlyCostCap.mockResolvedValue({ monthlyCostCapUsd: 10 });
  getOrgOverview.mockResolvedValue({
    range: "30d",
    usersWithActivity: 0,
    workspaceCount: 0,
    documentCount: 0,
    inferenceRequests: 0,
    promptTokens: 0,
    completionTokens: 0,
    estimatedCostUsd: 0,
    securityEvents: 0,
    highRiskBlocked: 0,
    byUser: [],
  });
  listDirectoryUsers.mockResolvedValue([]);
  findDirectoryUser.mockResolvedValue({
    username: "member@x.com",
    sub: "sub-1",
    email: "member@x.com",
    enabled: true,
    status: "CONFIRMED",
    role: "member",
    groups: ["Member"],
    createdAt: null,
    isOwner: false,
  });
});

describe("GET /api/admin/overview", () => {
  it("rejects members with 403", async () => {
    getIdentity.mockResolvedValue({
      userId: "member-1",
      authenticated: true,
      role: "member",
      groups: ["Member"],
    });
    const { GET } = await import("@/app/api/admin/overview/route");
    const res = await GET(new NextRequest("http://localhost/api/admin/overview"));
    expect(res.status).toBe(403);
    expect(getOrgOverview).not.toHaveBeenCalled();
  });

  it("allows operators", async () => {
    getIdentity.mockResolvedValue({
      userId: "operator-1",
      authenticated: true,
      email: "operator@securemind.local",
      role: "admin",
      groups: ["Operator"],
    });
    const { GET } = await import("@/app/api/admin/overview/route");
    const res = await GET(new NextRequest("http://localhost/api/admin/overview?range=7d"));
    expect(res.status).toBe(200);
    expect(getOrgOverview).toHaveBeenCalledWith("7d");
    expect(listDirectoryUsers).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.cognitoAvailable).toBe(true);
  });
});

describe("GET /api/admin/users", () => {
  it("rejects members with 403", async () => {
    getIdentity.mockResolvedValue({
      userId: "member-1",
      authenticated: true,
      role: "member",
      groups: ["Member"],
    });
    const { GET } = await import("@/app/api/admin/users/route");
    const res = await GET(new NextRequest("http://localhost/api/admin/users"));
    expect(res.status).toBe(403);
    expect(listDirectoryUsers).not.toHaveBeenCalled();
  });

  it("allows operators to list users", async () => {
    getIdentity.mockResolvedValue({
      userId: "operator-1",
      authenticated: true,
      role: "admin",
      groups: ["Operator"],
    });
    listDirectoryUsers.mockResolvedValue([
      {
        username: "member@securemind.local",
        sub: "sub-1",
        email: "member@securemind.local",
        enabled: true,
        status: "CONFIRMED",
        role: "member",
        groups: ["Member"],
        createdAt: null,
      },
    ]);
    const { GET } = await import("@/app/api/admin/users/route");
    const res = await GET(new NextRequest("http://localhost/api/admin/users"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.available).toBe(true);
    expect(body.users).toHaveLength(1);
    expect(body.users[0].profileStatus).toBe("active");
    expect(body.signInUrl).toBe("http://localhost:3000/");
    expect(body.passwordPolicy.minLength).toBeGreaterThanOrEqual(8);
    expect(Array.isArray(body.passwordPolicy.rules)).toBe(true);
  });
});

describe("POST /api/admin/users", () => {
  it("rejects members with 403", async () => {
    getIdentity.mockResolvedValue({
      userId: "member-1",
      authenticated: true,
      role: "member",
      groups: ["Member"],
    });
    const { POST } = await import("@/app/api/admin/users/route");
    const res = await POST(
      new NextRequest("http://localhost/api/admin/users", {
        method: "POST",
        body: JSON.stringify({
          email: "new@example.com",
          password: "Password1!",
          role: "member",
        }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(res.status).toBe(403);
    expect(createDirectoryUser).not.toHaveBeenCalled();
  });

  it("allows operators to create users", async () => {
    getIdentity.mockResolvedValue({
      userId: "operator-1",
      authenticated: true,
      role: "admin",
      groups: ["Operator"],
    });
    createDirectoryUser.mockResolvedValue({
      username: "new@example.com",
      email: "new@example.com",
      role: "admin",
      enabled: true,
      status: "CONFIRMED",
      groups: ["Operator", "Member"],
      sub: "sub-new",
      createdAt: null,
    });
    const { POST } = await import("@/app/api/admin/users/route");
    const res = await POST(
      new NextRequest("http://localhost/api/admin/users", {
        method: "POST",
        body: JSON.stringify({
          email: "new@example.com",
          password: "Password1!",
          role: "admin",
        }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(res.status).toBe(201);
    expect(createDirectoryUser).toHaveBeenCalledWith({
      email: "new@example.com",
      password: "Password1!",
      role: "admin",
    });
    expect(sendWelcomeAddedEmail).toHaveBeenCalledWith({
      to: "new@example.com",
      role: "admin",
      signInUrl: expect.stringMatching(/^https?:\/\//),
    });
    const body = await res.json();
    expect(body.welcomeEmail).toEqual({ sent: false, reason: "not_configured" });
    expect(body.signInUrl).toBe("http://localhost:3000/");
  });

  it("skips invite email when sendInvite is false", async () => {
    getIdentity.mockResolvedValue({
      userId: "operator-1",
      authenticated: true,
      role: "admin",
      groups: ["Operator"],
    });
    createDirectoryUser.mockResolvedValue({
      username: "new@example.com",
      email: "new@example.com",
      role: "member",
      enabled: true,
      status: "CONFIRMED",
      groups: ["Member"],
      sub: "sub-new",
      createdAt: null,
    });
    const { POST } = await import("@/app/api/admin/users/route");
    const res = await POST(
      new NextRequest("http://localhost/api/admin/users", {
        method: "POST",
        body: JSON.stringify({
          email: "new@example.com",
          password: "Password1!",
          role: "member",
          sendInvite: false,
        }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(res.status).toBe(201);
    expect(sendWelcomeAddedEmail).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.welcomeEmail).toEqual({ sent: false, reason: "skipped" });
  });
});

describe("PATCH /api/admin/users/[username]", () => {
  it("rejects members with 403", async () => {
    getIdentity.mockResolvedValue({
      userId: "member-1",
      authenticated: true,
      role: "member",
      groups: ["Member"],
    });
    const { PATCH } = await import("@/app/api/admin/users/[username]/route");
    const res = await PATCH(
      new NextRequest("http://localhost/api/admin/users/member%40x.com", {
        method: "PATCH",
        body: JSON.stringify({ role: "admin" }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ username: "member@x.com" }) },
    );
    expect(res.status).toBe(403);
    expect(setDirectoryUserRole).not.toHaveBeenCalled();
  });

  it("allows operators to promote members", async () => {
    getIdentity.mockResolvedValue({
      userId: "operator-1",
      authenticated: true,
      email: "operator@securemind.local",
      role: "admin",
      groups: ["Operator"],
    });
    setDirectoryUserRole.mockResolvedValue({
      username: "member@x.com",
      email: "member@x.com",
      role: "admin",
      enabled: true,
      status: "CONFIRMED",
      groups: ["Operator"],
      sub: "s",
      createdAt: null,
    });
    findDirectoryUser.mockResolvedValue({
      username: "member@x.com",
      sub: "s",
      email: "member@x.com",
      enabled: true,
      status: "CONFIRMED",
      role: "member",
      groups: ["Member"],
      createdAt: null,
      isOwner: false,
    });
    const { PATCH } = await import("@/app/api/admin/users/[username]/route");
    const res = await PATCH(
      new NextRequest("http://localhost/api/admin/users/member%40x.com", {
        method: "PATCH",
        body: JSON.stringify({ role: "admin" }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ username: "member@x.com" }) },
    );
    expect(res.status).toBe(200);
    expect(setDirectoryUserRole).toHaveBeenCalledWith("member@x.com", "admin", {
      actorUsername: "operator@securemind.local",
      actorRole: "admin",
      actorUserId: "operator-1",
    });
  });

  it("surfaces last-operator demote errors", async () => {
    const { CognitoAdminError } = await import("@/lib/cognito-admin");
    getIdentity.mockResolvedValue({
      userId: "operator-1",
      authenticated: true,
      email: "operator@securemind.local",
      role: "admin",
      groups: ["Operator"],
    });
    setDirectoryUserRole.mockRejectedValue(
      new CognitoAdminError("Cannot demote the last Admin or Super Admin.", 422),
    );
    findDirectoryUser.mockResolvedValue({
      username: "operator@securemind.local",
      sub: "sub-op",
      email: "operator@securemind.local",
      enabled: true,
      status: "CONFIRMED",
      role: "admin",
      groups: ["Operator"],
      createdAt: null,
      isOwner: false,
    });
    const { PATCH } = await import("@/app/api/admin/users/[username]/route");
    const res = await PATCH(
      new NextRequest("http://localhost/api/admin/users/operator%40securemind.local", {
        method: "PATCH",
        body: JSON.stringify({ role: "member" }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ username: "operator@securemind.local" }) },
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toMatch(/last admin/i);
  });

  it("sets a directory password without emailing the secret", async () => {
    getIdentity.mockResolvedValue({
      userId: "operator-1",
      authenticated: true,
      email: "operator@securemind.local",
      role: "admin",
      groups: ["Operator"],
    });
    adminSetDirectoryUserPassword.mockResolvedValue({
      username: "member@x.com",
      email: "member@x.com",
      role: "member",
      enabled: true,
      status: "CONFIRMED",
      groups: ["Member"],
      sub: "s",
      createdAt: null,
      isOwner: false,
    });
    const { PATCH } = await import("@/app/api/admin/users/[username]/route");
    const res = await PATCH(
      new NextRequest("http://localhost/api/admin/users/member%40x.com", {
        method: "PATCH",
        body: JSON.stringify({ password: "Password1!", notifyPasswordEmail: true }),
        headers: { "Content-Type": "application/json" },
      }),
      { params: Promise.resolve({ username: "member@x.com" }) },
    );
    expect(res.status).toBe(200);
    expect(adminSetDirectoryUserPassword).toHaveBeenCalledWith("member@x.com", "Password1!", {
      actorUsername: "operator@securemind.local",
      actorRole: "admin",
      actorUserId: "operator-1",
    });
    expect(sendAdminPasswordSetEmail).toHaveBeenCalledWith({ to: "member@x.com" });
    const body = await res.json();
    expect(body.passwordSet).toBe(true);
    expect(body.message).toMatch(/never emailed/i);
  });
});
