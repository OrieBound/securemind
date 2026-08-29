/**
 * Admin gate for instance security policy (sensitivity + safe terms).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getIdentity = vi.fn();
const getSecurityPolicy = vi.fn();
const applySecurityPolicy = vi.fn();
const proposeSecurityPolicy = vi.fn();
const clearPendingProposal = vi.fn();

vi.mock("@/lib/identity", async () => {
  const actual = await vi.importActual<typeof import("@/lib/identity")>("@/lib/identity");
  return {
    ...actual,
    getIdentity: (...args: unknown[]) => getIdentity(...args),
  };
});

vi.mock("@/lib/security-policy", async () => {
  const actual = await vi.importActual<typeof import("@/lib/security-policy")>(
    "@/lib/security-policy",
  );
  return {
    ...actual,
    getSecurityPolicy: (...args: unknown[]) => getSecurityPolicy(...args),
    applySecurityPolicy: (...args: unknown[]) => applySecurityPolicy(...args),
    proposeSecurityPolicy: (...args: unknown[]) => proposeSecurityPolicy(...args),
    clearPendingProposal: (...args: unknown[]) => clearPendingProposal(...args),
  };
});

const basePolicy = {
  piiSensitivity: "balanced" as const,
  safeTerms: [],
  pending: null,
  updatedAt: null,
  updatedByUserId: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  getSecurityPolicy.mockResolvedValue(basePolicy);
});

describe("PUT /api/settings/security", () => {
  it("rejects members with 403", async () => {
    getIdentity.mockResolvedValue({
      userId: "member-1",
      authenticated: true,
      role: "member",
      groups: ["Member"],
    });
    const { PUT } = await import("@/app/api/settings/security/route");
    const res = await PUT(
      new NextRequest("http://localhost/api/settings/security", {
        method: "PUT",
        body: JSON.stringify({ piiSensitivity: "high" }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(res.status).toBe(403);
    expect(applySecurityPolicy).not.toHaveBeenCalled();
  });

  it("allows admins to apply policy without rescrub flags", async () => {
    getIdentity.mockResolvedValue({
      userId: "admin-1",
      authenticated: true,
      role: "admin",
      groups: ["Admin"],
    });
    applySecurityPolicy.mockResolvedValue({
      policy: { ...basePolicy, piiSensitivity: "high" },
    });
    const { PUT } = await import("@/app/api/settings/security/route");
    const res = await PUT(
      new NextRequest("http://localhost/api/settings/security", {
        method: "PUT",
        body: JSON.stringify({ piiSensitivity: "high", safeTerms: [] }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(res.status).toBe(200);
    expect(applySecurityPolicy).toHaveBeenCalledWith({
      actorUserId: "admin-1",
      piiSensitivity: "high",
      safeTerms: [],
    });
    const body = await res.json();
    expect(body.piiSensitivity).toBe("high");
    expect(body.rescrubbed).toBeUndefined();
  });
});

describe("POST /api/settings/security propose", () => {
  it("allows members to propose", async () => {
    getIdentity.mockResolvedValue({
      userId: "member-1",
      authenticated: true,
      role: "member",
      groups: ["Member"],
    });
    proposeSecurityPolicy.mockResolvedValue({
      ...basePolicy,
      pending: {
        piiSensitivity: "high",
        safeTerms: null,
        proposedByUserId: "member-1",
        proposedAt: new Date().toISOString(),
        note: null,
        stricterThanActive: true,
      },
    });
    const { POST } = await import("@/app/api/settings/security/route");
    const res = await POST(
      new NextRequest("http://localhost/api/settings/security", {
        method: "POST",
        body: JSON.stringify({ piiSensitivity: "high" }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(res.status).toBe(200);
    expect(proposeSecurityPolicy).toHaveBeenCalled();
  });
});
