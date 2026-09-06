/**
 * Custom avatar route uses getIdentity — never a client-supplied userId.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getIdentity = vi.fn();
const readAvatar = vi.fn();
const writeAvatar = vi.fn();
const removeAvatar = vi.fn();

vi.mock("@/lib/identity", async () => {
  const actual = await vi.importActual<typeof import("@/lib/identity")>("@/lib/identity");
  return {
    ...actual,
    getIdentity: (...args: unknown[]) => getIdentity(...args),
  };
});

vi.mock("@/lib/avatar-storage", () => ({
  readAvatar: (...args: unknown[]) => readAvatar(...args),
  writeAvatar: (...args: unknown[]) => writeAvatar(...args),
  removeAvatar: (...args: unknown[]) => removeAvatar(...args),
  avatarPublicUrl: vi.fn(() => null),
  readAvatarMeta: vi.fn(() => null),
}));

const member = {
  userId: "sub-member",
  authenticated: true,
  email: "member@example.com",
  role: "member" as const,
  groups: ["Member"],
};

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3]);

beforeEach(() => {
  vi.clearAllMocks();
  getIdentity.mockResolvedValue(member);
  writeAvatar.mockReturnValue({ contentType: "image/png", updatedAt: "2026-09-06T00:00:00.000Z" });
});

describe("GET /api/me/avatar", () => {
  it("reads the identity user, not a query userId", async () => {
    readAvatar.mockReturnValue({
      bytes: PNG,
      meta: { contentType: "image/png", updatedAt: "2026-09-06T00:00:00.000Z" },
    });
    const { GET } = await import("@/app/api/me/avatar/route");
    const res = await GET(
      new NextRequest("http://localhost/api/me/avatar?userId=victim-user-id"),
    );
    expect(res.status).toBe(200);
    expect(readAvatar).toHaveBeenCalledWith("sub-member");
    expect(readAvatar).not.toHaveBeenCalledWith("victim-user-id");
    expect(res.headers.get("content-type")).toBe("image/png");
  });
});

describe("PUT /api/me/avatar", () => {
  it("stores against the identity user even if the form names another", async () => {
    const form = new FormData();
    form.set("userId", "victim-user-id");
    form.set("file", new Blob([new Uint8Array(PNG)], { type: "image/png" }), "face.png");
    const { PUT } = await import("@/app/api/me/avatar/route");
    const res = await PUT(
      new NextRequest("http://localhost/api/me/avatar", { method: "PUT", body: form }),
    );
    expect(res.status).toBe(200);
    expect(writeAvatar).toHaveBeenCalledWith("sub-member", expect.any(Buffer), "image/png");
    expect(writeAvatar.mock.calls[0][0]).not.toBe("victim-user-id");
  });

  it("rejects a non-image", async () => {
    const { PUT } = await import("@/app/api/me/avatar/route");
    const res = await PUT(
      new NextRequest("http://localhost/api/me/avatar", {
        method: "PUT",
        body: "<svg xmlns='http://www.w3.org/2000/svg'></svg>",
        headers: { "Content-Type": "image/svg+xml" },
      }),
    );
    expect(res.status).toBe(422);
    expect(writeAvatar).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/me/avatar", () => {
  it("removes only the identity user's file", async () => {
    const { DELETE } = await import("@/app/api/me/avatar/route");
    const res = await DELETE(new NextRequest("http://localhost/api/me/avatar", { method: "DELETE" }));
    expect(res.status).toBe(200);
    expect(removeAvatar).toHaveBeenCalledWith("sub-member");
  });
});
