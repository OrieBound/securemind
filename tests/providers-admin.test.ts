/**
 * Admin gate for instance provider settings.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getIdentity = vi.fn();
const getPublicProviderStatus = vi.fn();
const getVendorConsentFlags = vi.fn();
const patchInstanceConfig = vi.fn();

vi.mock("@/lib/identity", async () => {
  const actual = await vi.importActual<typeof import("@/lib/identity")>("@/lib/identity");
  return {
    ...actual,
    getIdentity: (...args: unknown[]) => getIdentity(...args),
  };
});

vi.mock("@/lib/instance-config", () => ({
  getPublicProviderStatus: (...args: unknown[]) => getPublicProviderStatus(...args),
  getVendorConsentFlags: (...args: unknown[]) => getVendorConsentFlags(...args),
  patchInstanceConfig: (...args: unknown[]) => patchInstanceConfig(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  getPublicProviderStatus.mockResolvedValue({
    primaryProvider: "auto",
    hasGroqKey: false,
    groqKeyHint: null,
    hasEnvGroqKey: false,
    hasBedrockCreds: false,
    bedrockKeyHint: null,
    bedrockRegion: null,
    bedrockChatModel: null,
    hasEnvAwsKeys: false,
    externalRiskAckAt: null,
  });
});

describe("PUT /api/settings/providers", () => {
  it("rejects members with 403", async () => {
    getIdentity.mockResolvedValue({
      userId: "member-1",
      authenticated: true,
      role: "member",
      groups: ["Member"],
    });
    const { PUT } = await import("@/app/api/settings/providers/route");
    const res = await PUT(
      new NextRequest("http://localhost/api/settings/providers", {
        method: "PUT",
        body: JSON.stringify({ primaryProvider: "groq" }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(res.status).toBe(403);
    expect(patchInstanceConfig).not.toHaveBeenCalled();
  });

  it("allows admins to patch config", async () => {
    getIdentity.mockResolvedValue({
      userId: "admin-1",
      authenticated: true,
      role: "admin",
      groups: ["Admin"],
    });
    patchInstanceConfig.mockResolvedValue({
      primaryProvider: "groq",
      hasGroqKey: false,
      groqKeyHint: null,
      hasEnvGroqKey: true,
      hasBedrockCreds: false,
      bedrockKeyHint: null,
      bedrockRegion: null,
      bedrockChatModel: null,
      hasEnvAwsKeys: false,
      externalRiskAckAt: null,
    });
    const { PUT } = await import("@/app/api/settings/providers/route");
    const res = await PUT(
      new NextRequest("http://localhost/api/settings/providers", {
        method: "PUT",
        body: JSON.stringify({ primaryProvider: "groq" }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(res.status).toBe(200);
    expect(patchInstanceConfig).toHaveBeenCalled();
  });

  it("forwards acknowledgeExternalRisk false so consent can be revoked", async () => {
    getIdentity.mockResolvedValue({
      userId: "admin-1",
      authenticated: true,
      role: "admin",
      groups: ["Admin"],
    });
    patchInstanceConfig.mockResolvedValue({
      primaryProvider: "auto",
      hasGroqKey: false,
      groqKeyHint: null,
      hasEnvGroqKey: false,
      hasBedrockCreds: false,
      bedrockKeyHint: null,
      bedrockRegion: null,
      bedrockChatModel: null,
      hasEnvAwsKeys: false,
      externalRiskAckAt: null,
    });
    const { PUT } = await import("@/app/api/settings/providers/route");
    const res = await PUT(
      new NextRequest("http://localhost/api/settings/providers", {
        method: "PUT",
        body: JSON.stringify({ acknowledgeExternalRisk: false }),
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(res.status).toBe(200);
    expect(patchInstanceConfig).toHaveBeenCalledWith(
      expect.objectContaining({ acknowledgeExternalRisk: false }),
      "admin-1",
    );
  });
});

describe("GET /api/settings/providers", () => {
  it("lite=1 skips AWS credential detection", async () => {
    getIdentity.mockResolvedValue({
      userId: "local",
      authenticated: true,
      role: "admin",
      groups: ["Admin"],
    });
    getVendorConsentFlags.mockResolvedValue({
      hasGroqKey: true,
      hasEnvGroqKey: false,
      externalRiskAckAt: null,
    });
    const { GET } = await import("@/app/api/settings/providers/route");
    const res = await GET(new NextRequest("http://localhost/api/settings/providers?lite=1"));
    expect(res.status).toBe(200);
    const body = await res.json() as { hasGroqKey?: boolean };
    expect(body.hasGroqKey).toBe(true);
    expect(getVendorConsentFlags).toHaveBeenCalled();
    expect(getPublicProviderStatus).not.toHaveBeenCalled();
  });
});
