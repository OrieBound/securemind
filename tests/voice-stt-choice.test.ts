/**
 * First-mic transcription chooser: any signed-in user can pick Groq or
 * Amazon Transcribe; only Admin may paste a Groq key or enable billable AWS.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getIdentity = vi.fn();
const getVendorConsentFlags = vi.fn();
const instanceCanUseBedrock = vi.fn();
const patchInstanceConfig = vi.fn();

vi.mock("@/lib/identity", async () => {
  const actual = await vi.importActual<typeof import("@/lib/identity")>("@/lib/identity");
  return {
    ...actual,
    getIdentity: (...args: unknown[]) => getIdentity(...args),
  };
});

vi.mock("@/lib/instance-config", () => {
  class ProviderConfigError extends Error {
    status: number;
    constructor(message: string, status = 422) {
      super(message);
      this.name = "ProviderConfigError";
      this.status = status;
    }
  }
  return {
    ProviderConfigError,
    getVendorConsentFlags: (...args: unknown[]) => getVendorConsentFlags(...args),
    instanceCanUseBedrock: (...args: unknown[]) => instanceCanUseBedrock(...args),
    patchInstanceConfig: (...args: unknown[]) => patchInstanceConfig(...args),
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  getVendorConsentFlags.mockResolvedValue({
    hasGroqKey: false,
    hasEnvGroqKey: false,
    externalRiskAckAt: null,
    voiceSttChoice: null,
    voiceSttAudioAckAt: null,
    allowRealAws: false,
  });
  instanceCanUseBedrock.mockResolvedValue(false);
  patchInstanceConfig.mockResolvedValue({
    voiceSttChoice: "groq",
    hasGroqKey: true,
  });
});

function put(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/settings/voice-stt", {
    method: "PUT",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("PUT /api/settings/voice-stt", () => {
  it("rejects a missing choice", async () => {
    getIdentity.mockResolvedValue({
      userId: "admin-1",
      authenticated: true,
      role: "admin",
      groups: ["Admin"],
    });
    const { PUT } = await import("@/app/api/settings/voice-stt/route");
    const res = await PUT(put({ acknowledgeVoiceAudio: true }));
    expect(res.status).toBe(422);
    expect(patchInstanceConfig).not.toHaveBeenCalled();
  });

  it("rejects Groq without a key", async () => {
    getIdentity.mockResolvedValue({
      userId: "admin-1",
      authenticated: true,
      role: "admin",
      groups: ["Admin"],
    });
    const { PUT } = await import("@/app/api/settings/voice-stt/route");
    const res = await PUT(put({ choice: "groq", acknowledgeVoiceAudio: true }));
    expect(res.status).toBe(422);
    expect(patchInstanceConfig).not.toHaveBeenCalled();
  });

  it("lets an Admin save Groq with a pasted key and audio acknowledgement", async () => {
    getIdentity.mockResolvedValue({
      userId: "admin-1",
      authenticated: true,
      role: "admin",
      groups: ["Admin"],
    });
    const { PUT } = await import("@/app/api/settings/voice-stt/route");
    const res = await PUT(
      put({
        choice: "groq",
        acknowledgeVoiceAudio: true,
        groqApiKey: "gsk_testkey_not_real",
      }),
    );
    expect(res.status).toBe(200);
    expect(patchInstanceConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        voiceSttChoice: "groq",
        acknowledgeVoiceAudio: true,
        groqApiKey: "gsk_testkey_not_real",
        acknowledgeExternalRisk: true,
      }),
      "admin-1",
    );
  });

  it("refuses a member who tries to paste a Groq key", async () => {
    getIdentity.mockResolvedValue({
      userId: "member-1",
      authenticated: true,
      role: "member",
      groups: ["Member"],
    });
    const { PUT } = await import("@/app/api/settings/voice-stt/route");
    const res = await PUT(
      put({
        choice: "groq",
        acknowledgeVoiceAudio: true,
        groqApiKey: "gsk_testkey_not_real",
      }),
    );
    expect(res.status).toBe(403);
    expect(patchInstanceConfig).not.toHaveBeenCalled();
  });

  it("lets a member choose Groq when a key is already stored", async () => {
    getIdentity.mockResolvedValue({
      userId: "member-1",
      authenticated: true,
      role: "member",
      groups: ["Member"],
    });
    getVendorConsentFlags.mockResolvedValue({
      hasGroqKey: true,
      hasEnvGroqKey: false,
      externalRiskAckAt: "2026-08-01T00:00:00.000Z",
      voiceSttChoice: null,
      voiceSttAudioAckAt: null,
      allowRealAws: false,
    });
    const { PUT } = await import("@/app/api/settings/voice-stt/route");
    const res = await PUT(put({ choice: "groq", acknowledgeVoiceAudio: true }));
    expect(res.status).toBe(200);
    expect(patchInstanceConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        voiceSttChoice: "groq",
        acknowledgeVoiceAudio: true,
      }),
      "member-1",
    );
  });

  it("requires billable AWS (or Admin enable) for Amazon Transcribe", async () => {
    getIdentity.mockResolvedValue({
      userId: "member-1",
      authenticated: true,
      role: "member",
      groups: ["Member"],
    });
    const { PUT } = await import("@/app/api/settings/voice-stt/route");
    const res = await PUT(put({ choice: "transcribe", acknowledgeVoiceAudio: true }));
    expect(res.status).toBe(422);
  });
});
