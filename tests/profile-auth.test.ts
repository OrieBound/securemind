/**
 * Profile + password route authorization / validation.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getIdentity = vi.fn();
const ensureUserProfile = vi.fn();
const patchUserProfile = vi.fn();
const cognitoConfigured = vi.fn();
const cognitoForgotPassword = vi.fn();
const cognitoChangePassword = vi.fn();
const readAccessTokenFromRequest = vi.fn();

vi.mock("@/lib/identity", async () => {
  const actual = await vi.importActual<typeof import("@/lib/identity")>("@/lib/identity");
  return {
    ...actual,
    getIdentity: (...args: unknown[]) => getIdentity(...args),
  };
});

vi.mock("@/lib/user-profile", () => ({
  ensureUserProfile: (...args: unknown[]) => ensureUserProfile(...args),
  patchUserProfile: (...args: unknown[]) => patchUserProfile(...args),
  getUserProfile: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    userProfile: {
      findUnique: vi.fn().mockResolvedValue({ monthlyCostCapUsd: null }),
    },
    inferenceEvent: {
      aggregate: vi.fn().mockResolvedValue({ _sum: { estimatedCostUsd: 0 } }),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    instanceConfig: {
      findUnique: vi.fn().mockResolvedValue({ defaultMonthlyCostCapUsd: 10 }),
    },
    workspace: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

vi.mock("@/lib/cognito", () => ({
  cognitoConfigured: () => cognitoConfigured(),
  cognitoForgotPassword: (...args: unknown[]) => cognitoForgotPassword(...args),
  cognitoChangePassword: (...args: unknown[]) => cognitoChangePassword(...args),
  cognitoConfirmForgotPassword: vi.fn(),
}));

vi.mock("@/lib/auth-cookies", () => ({
  readAccessTokenFromRequest: (...args: unknown[]) => readAccessTokenFromRequest(...args),
  clearAccessCookieHeader: () => "sm_access_token=; Max-Age=0; Path=/",
  accessCookieHeader: () => "sm_access_token=x",
}));

const member = {
  userId: "sub-member",
  authenticated: true,
  email: "member@example.com",
  role: "member" as const,
  groups: ["Member"],
};

const baseProfile = {
  userId: "sub-member",
  email: "member@example.com",
  displayName: "Member",
  handle: null,
  jobTitle: null,
  bio: null,
  timezone: null,
  locale: null,
  avatarPreset: "shield",
  themePreference: null,
  density: null,
  defaultLanding: null,
  defaultWorkspaceId: null,
  preferredModelId: null,
  notificationPrefs: null,
  status: "active" as const,
  lastSignInAt: null,
  deletedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

beforeEach(() => {
  vi.clearAllMocks();
  getIdentity.mockResolvedValue(member);
  ensureUserProfile.mockResolvedValue(baseProfile);
  patchUserProfile.mockResolvedValue(baseProfile);
  cognitoConfigured.mockReturnValue(true);
  readAccessTokenFromRequest.mockReturnValue("tok");
  process.env.AUTH_MODE = "cognito";
});

describe("GET /api/me/profile", () => {
  it("returns profile for member", async () => {
    const { GET } = await import("@/app/api/me/profile/route");
    const res = await GET(new NextRequest("http://localhost/api/me/profile"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.profile.userId).toBe("sub-member");
    expect(body.role).toBe("member");
  });
});

describe("PATCH /api/me/profile", () => {
  it("rejects privileged field smuggling", async () => {
    const { PATCH } = await import("@/app/api/me/profile/route");
    const res = await PATCH(
      new NextRequest("http://localhost/api/me/profile", {
        method: "PATCH",
        body: JSON.stringify({ role: "admin", displayName: "X" }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(res.status).toBe(422);
    expect(patchUserProfile).not.toHaveBeenCalled();
  });

  it("patches display name", async () => {
    const { PATCH } = await import("@/app/api/me/profile/route");
    const res = await PATCH(
      new NextRequest("http://localhost/api/me/profile", {
        method: "PATCH",
        body: JSON.stringify({ displayName: "Ada", avatarPreset: "orbit" }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(res.status).toBe(200);
    expect(patchUserProfile).toHaveBeenCalledWith(
      "sub-member",
      expect.objectContaining({ displayName: "Ada", avatarPreset: "orbit" }),
    );
  });
});

describe("POST /api/auth/forgot-password", () => {
  it("returns generic success even when cognito throws", async () => {
    cognitoForgotPassword.mockRejectedValue(new Error("UserNotFoundException"));
    const { POST } = await import("@/app/api/auth/forgot-password/route");
    const res = await POST(
      new NextRequest("http://localhost/api/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email: "nobody@example.com" }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.message).toMatch(/if an account exists/i);
  });
});

describe("avatar presets", () => {
  it("rejects unknown preset ids", async () => {
    const { isAvatarPresetId } = await import("@/lib/avatar-presets");
    expect(isAvatarPresetId("shield")).toBe(true);
    expect(isAvatarPresetId("hack.exe")).toBe(false);
  });
});

describe("handle validation", () => {
  it("enforces reserved names and format", async () => {
    const actual = await vi.importActual<typeof import("@/lib/user-profile")>(
      "@/lib/user-profile",
    );
    expect(actual.validateHandle("admin").ok).toBe(false);
    expect(actual.validateHandle("ab").ok).toBe(false);
    expect(actual.validateHandle("ada-lovelace").ok).toBe(true);
  });
});
