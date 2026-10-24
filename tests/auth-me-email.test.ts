import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getIdentity = vi.fn();
const getUserProfile = vi.fn();

vi.mock("@/lib/identity", async () => {
  const actual = await vi.importActual<typeof import("@/lib/identity")>("@/lib/identity");
  return { ...actual, getIdentity: (...a: unknown[]) => getIdentity(...a) };
});
vi.mock("@/lib/user-profile", () => ({ getUserProfile: (...a: unknown[]) => getUserProfile(...a) }));
vi.mock("@/lib/auth-cookies", () => ({ readAccessTokenFromRequest: () => null }));

beforeEach(() => vi.clearAllMocks());

const call = async () => {
  const { GET } = await import("@/app/api/auth/me/route");
  return (await GET(new NextRequest("http://localhost/api/auth/me"))).json();
};

describe("GET /api/auth/me email", () => {
  it("fills in the email from the account's own profile when the token has none", async () => {
    getIdentity.mockResolvedValue({ userId: "sub-1", authenticated: true, role: "member", groups: [] });
    getUserProfile.mockResolvedValue({ email: "member@example.com" });
    expect((await call()).email).toBe("member@example.com");
    expect(getUserProfile).toHaveBeenCalledWith("sub-1");
  });

  it("keeps the token's email and skips the lookup", async () => {
    getIdentity.mockResolvedValue({ userId: "sub-1", authenticated: true, email: "t@example.com", role: "admin", groups: [] });
    expect((await call()).email).toBe("t@example.com");
    expect(getUserProfile).not.toHaveBeenCalled();
  });

  it("still answers when the profile cannot be read", async () => {
    getIdentity.mockResolvedValue({ userId: "sub-1", authenticated: true, role: "member", groups: [] });
    getUserProfile.mockRejectedValue(new Error("down"));
    expect((await call()).email).toBeNull();
  });

  it("does not look anything up for an unauthenticated or local session", async () => {
    getIdentity.mockResolvedValue({ userId: "local", authenticated: true, role: "super_admin", groups: [] });
    await call();
    getIdentity.mockResolvedValue({ userId: "", authenticated: false, role: "member", groups: [] });
    await call();
    expect(getUserProfile).not.toHaveBeenCalled();
  });
});
