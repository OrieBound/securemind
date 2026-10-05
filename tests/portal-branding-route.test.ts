import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  read: vi.fn(),
  save: vi.fn(),
  reset: vi.fn(),
}));

vi.mock("@/lib/identity", async importOriginal => ({
  ...(await importOriginal<typeof import("@/lib/identity")>()),
  getIdentity: mocks.identity,
}));

vi.mock("@/lib/portal-branding", () => ({
  readPortalChrome: mocks.read,
  savePortalText: mocks.save,
  resetPortalBranding: mocks.reset,
}));

import { GET, PATCH } from "@/app/api/settings/portal/route";

const chrome = {
  name: "Northwind",
  tagline: "Care workspace",
  hasCustomLogo: false,
  logoUrl: null,
  isDefault: false,
  limits: { name: 22, tagline: 28 },
};

function patch(body: unknown) {
  return new NextRequest("http://localhost/api/settings/portal", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.identity.mockResolvedValue({
    userId: "admin-1",
    role: "admin",
    authenticated: true,
    groups: ["Admin"],
  });
  mocks.read.mockResolvedValue(chrome);
  mocks.save.mockResolvedValue(chrome);
  mocks.reset.mockResolvedValue({ ...chrome, name: "SecureMind", isDefault: true });
});

describe("portal branding route", () => {
  it("lets a member read the sidebar chrome", async () => {
    mocks.identity.mockResolvedValue({
      userId: "member-1",
      role: "member",
      authenticated: true,
      groups: [],
    });
    const res = await GET(new NextRequest("http://localhost/api/settings/portal"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("Northwind");
    expect(body.canEdit).toBe(false);
  });

  it("refuses a member before writing", async () => {
    mocks.identity.mockResolvedValue({
      userId: "member-1",
      role: "member",
      authenticated: true,
      groups: [],
    });
    const res = await PATCH(patch({ name: "Acme", tagline: "Notes", userId: "spoofed" }));
    expect(res.status).toBe(403);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.reset).not.toHaveBeenCalled();
  });

  it("saves with the authenticated admin id and rejects an empty name", async () => {
    const ok = await PATCH(patch({ name: "  Harbor Light  ", tagline: "Clinic notes", userId: "spoofed" }));
    expect(ok.status).toBe(200);
    expect(mocks.save).toHaveBeenCalledWith("admin-1", "Harbor Light", "Clinic notes");

    const bad = await PATCH(patch({ name: "   ", tagline: "Clinic notes" }));
    expect(bad.status).toBe(422);
    expect(mocks.save).toHaveBeenCalledTimes(1);
  });

  it("restores defaults without taking a user id from the body", async () => {
    const res = await PATCH(patch({ reset: true, userId: "spoofed" }));
    expect(res.status).toBe(200);
    expect(mocks.reset).toHaveBeenCalledWith("admin-1");
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
