/**
 * POST /api/transcribe/live-session hands out a signed Transcribe address. These tests pin who may
 * ask for one, when it is refused, that the response carries nothing but the address, and that the
 * temporary credentials come from the dedicated role with the narrow session policy.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = {
  edition: "cloud" as "cloud" | "local",
  identity: "user-a" as string | null,
  awsOk: true,
  choice: "transcribe" as string | null,
  acked: true,
};

class IdentityErrorStub extends Error {
  status = 401;
}

vi.mock("@/lib/identity", () => ({
  getIdentity: vi.fn(async () => {
    if (!state.identity) throw new IdentityErrorStub("no session");
    return { userId: state.identity, authenticated: true, role: "member", groups: [] };
  }),
  identityErrorResponse: (e: unknown) =>
    e instanceof IdentityErrorStub ? Response.json({ error: "Unauthorized" }, { status: 401 }) : null,
}));
vi.mock("@/lib/runtime-env", () => ({ runtimeEdition: () => state.edition }));
vi.mock("@/lib/instance-config", () => ({
  instanceCanUseBedrock: async () => state.awsOk,
  resolveRuntimeSecrets: async () => ({ voiceSttChoice: state.choice, voiceSttAudioAcked: state.acked }),
  getInstanceAwsStatus: async () => ({ profile: null, region: "us-east-1" }),
}));

const assumeRole = vi.fn();
vi.mock("@/lib/aws-credentials", () => ({ withRealAwsEndpoints: (fn: () => Promise<unknown>) => fn() }));
vi.mock("@aws-sdk/client-sts", () => ({
  STSClient: class {
    send = (cmd: unknown) => assumeRole(cmd);
  },
  AssumeRoleCommand: class {
    constructor(public input: Record<string, unknown>) {}
  },
}));

const capState = { capped: false };
const recordInferenceEvent = vi.fn(async () => {});
vi.mock("@/lib/cost-cap", () => ({
  getUserCostCapStatus: async () => ({
    capped: capState.capped,
    spentUsd: 12,
    capUsd: 10,
    resetsAt: "2026-11-01T00:00:00.000Z",
    warningLevel: null,
  }),
}));
vi.mock("@/lib/analytics/write", () => ({
  recordInferenceEvent: (...a: unknown[]) => recordInferenceEvent(...(a as [])),
}));

const ROLE = "arn:aws:iam::123456789012:role/securemind-transcribe-stream-prod";

function post() {
  return new NextRequest("http://localhost/api/transcribe/live-session", { method: "POST" });
}

beforeEach(async () => {
  vi.clearAllMocks();
  state.edition = "cloud";
  state.identity = "user-a";
  state.awsOk = true;
  state.choice = "transcribe";
  state.acked = true;
  capState.capped = false;
  process.env.TRANSCRIBE_STREAM_ROLE_ARN = ROLE;
  process.env.TRANSCRIBE_STREAM_REGION = "us-east-1";
  assumeRole.mockResolvedValue({
    Credentials: { AccessKeyId: "ASIATEMP", SecretAccessKey: "super-secret-key", SessionToken: "tok" },
  });
  (await import("@/lib/rate-limit")).resetRateLimits();
});

describe("POST /api/transcribe/live-session", () => {
  it("returns a signed address that never contains the secret key", async () => {
    const { POST } = await import("@/app/api/transcribe/live-session/route");
    const res = await POST(post());
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["expiresInSeconds", "sampleRate", "url"]);
    expect(body.url).toMatch(/^wss:\/\/transcribestreaming\.us-east-1\.amazonaws\.com:8443\/stream-transcription-websocket\?/);
    expect(body.url).toContain("X-Amz-Signature=");
    expect(JSON.stringify(body)).not.toContain("super-secret-key");
  });

  it("asks STS for the dedicated role, for the shortest session, with the one-action policy", async () => {
    const { POST } = await import("@/app/api/transcribe/live-session/route");
    await POST(post());
    const input = (assumeRole.mock.calls[0]![0] as { input: Record<string, unknown> }).input;
    expect(input.RoleArn).toBe(ROLE);
    expect(input.DurationSeconds).toBe(900);
    expect(JSON.parse(input.Policy as string).Statement).toEqual([
      { Effect: "Allow", Action: "transcribe:StartStreamTranscriptionWebSocket", Resource: "*" },
    ]);
    // The session name identifies the caller in CloudTrail without containing the user id itself.
    expect(String(input.RoleSessionName)).toMatch(/^sm-voice-[0-9a-f]{16}$/);
    expect(String(input.RoleSessionName)).not.toContain("user-a");
  });

  it("refuses a caller without a session", async () => {
    state.identity = null;
    const { POST } = await import("@/app/api/transcribe/live-session/route");
    expect((await POST(post())).status).toBe(401);
    expect(assumeRole).not.toHaveBeenCalled();
  });

  it("does not exist on a local or Docker install", async () => {
    state.edition = "local";
    const { POST } = await import("@/app/api/transcribe/live-session/route");
    expect((await POST(post())).status).toBe(404);
    expect(assumeRole).not.toHaveBeenCalled();
  });

  it("is off, not broken, when the role is not configured", async () => {
    delete process.env.TRANSCRIBE_STREAM_ROLE_ARN;
    const { POST } = await import("@/app/api/transcribe/live-session/route");
    expect((await POST(post())).status).toBe(404);
    expect(assumeRole).not.toHaveBeenCalled();
  });

  it("is refused when the Admin has not chosen Amazon Transcribe", async () => {
    state.choice = "groq";
    const { POST } = await import("@/app/api/transcribe/live-session/route");
    expect((await POST(post())).status).toBe(503);
    expect(assumeRole).not.toHaveBeenCalled();
  });

  it("is refused until the Admin has accepted that audio goes to AWS", async () => {
    state.acked = false;
    const { POST } = await import("@/app/api/transcribe/live-session/route");
    expect((await POST(post())).status).toBe(503);
    expect(assumeRole).not.toHaveBeenCalled();
  });

  it("limits how fast one account can ask", async () => {
    const { POST } = await import("@/app/api/transcribe/live-session/route");
    for (let i = 0; i < 20; i++) expect((await POST(post())).status).toBe(200);
    const res = await POST(post());
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
    // Another account is not held back by the first one's burst.
    state.identity = "user-b";
    expect((await POST(post())).status).toBe(200);
  });

  it("is refused once the user is over their monthly cost cap, before anything is signed", async () => {
    capState.capped = true;
    const { POST } = await import("@/app/api/transcribe/live-session/route");
    const res = await POST(post());
    expect(res.status).toBe(402);
    expect((await res.json()).code).toBe("cost_cap_exceeded");
    expect(assumeRole).not.toHaveBeenCalled();
    expect(recordInferenceEvent).not.toHaveBeenCalled();
  });

  it("records each session toward the cost cap as a flat estimate", async () => {
    const { POST } = await import("@/app/api/transcribe/live-session/route");
    await POST(post());
    expect(recordInferenceEvent).toHaveBeenCalledTimes(1);
    const ev = (recordInferenceEvent.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(ev).toMatchObject({ userId: "user-a", provider: "transcribe", tier: "Voice", status: "ok" });
    expect(ev.extraCostUsd).toBeCloseTo(0.024);
  });

  it("reports a signing failure without echoing the error to the browser", async () => {
    assumeRole.mockRejectedValue(new Error("AccessDenied: arn:aws:iam::123456789012:role/x"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { POST } = await import("@/app/api/transcribe/live-session/route");
    const res = await POST(post());
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain("arn:aws");
    spy.mockRestore();
  });
});
