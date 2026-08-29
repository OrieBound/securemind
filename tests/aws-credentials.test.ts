/**
 * AWS credentials must never come from the UI or the database, and billable
 * Bedrock calls must stay closed until an operator opts in.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const fromNodeProviderChain = vi.fn();
vi.mock("@aws-sdk/credential-providers", () => ({
  fromNodeProviderChain: (...args: unknown[]) => fromNodeProviderChain(...args),
}));

const saved: Record<string, string | undefined> = {};
function setEnv(key: string, value: string | undefined) {
  if (!(key in saved)) saved[key] = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

beforeEach(async () => {
  vi.clearAllMocks();
  const { resetAwsCredentialCache } = await import("@/lib/aws-credentials");
  resetAwsCredentialCache();
  fromNodeProviderChain.mockReturnValue(async () => ({
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "shhh",
  }));
});

afterEach(async () => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
    delete saved[key];
  }
  const { resetAwsCredentialCache } = await import("@/lib/aws-credentials");
  resetAwsCredentialCache();
});

describe("canUseBedrock", () => {
  it("stays closed when neither the app toggle nor the env override is set", async () => {
    setEnv("ALLOW_REAL_AWS", undefined);
    setEnv("AWS_REGION", "us-east-1");
    const { canUseBedrock } = await import("@/lib/aws-credentials");
    expect(await canUseBedrock({ allowRealAws: false })).toBe(false);
  });

  it("opens from the app toggle alone — no env var required", async () => {
    setEnv("ALLOW_REAL_AWS", undefined);
    const { canUseBedrock } = await import("@/lib/aws-credentials");
    expect(await canUseBedrock({ allowRealAws: true, region: "us-east-1" })).toBe(true);
  });

  it("lets ALLOW_REAL_AWS=false in the environment override the app toggle", async () => {
    setEnv("ALLOW_REAL_AWS", "false");
    const { canUseBedrock, getAwsCredentialStatus } = await import("@/lib/aws-credentials");
    const settings = { allowRealAws: true, region: "us-east-1" };
    expect(await canUseBedrock(settings)).toBe(false);
    const status = await getAwsCredentialStatus(settings);
    expect(status.lockedByEnvironment).toBe(true);
  });

  it("hides Floci placeholder keys from the provider chain", async () => {
    setEnv("AWS_ACCESS_KEY_ID", "test");
    setEnv("AWS_SECRET_ACCESS_KEY", "test");
    let seen: string | undefined = "unset";
    fromNodeProviderChain.mockReturnValue(async () => {
      seen = process.env.AWS_ACCESS_KEY_ID;
      return { accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "shhh" };
    });

    const { getAwsCredentialStatus } = await import("@/lib/aws-credentials");
    const status = await getAwsCredentialStatus({
      allowRealAws: true,
      region: "us-east-1",
      profile: "work-sso",
    });

    expect(seen).toBeUndefined();
    // A real profile resolves even on a Floci-configured host.
    expect(status.detected).toBe(true);
    expect(status.looksLikeFloci).toBe(false);
    // Restored once resolution finishes.
    expect(process.env.AWS_ACCESS_KEY_ID).toBe("test");
  });

  it("refuses Bedrock when placeholders are all that is available", async () => {
    setEnv("AWS_ACCESS_KEY_ID", "test");
    setEnv("AWS_SECRET_ACCESS_KEY", "test");
    fromNodeProviderChain.mockReturnValue(async () => {
      throw new Error("Could not load credentials from any providers");
    });

    const settings = { allowRealAws: true, region: "us-east-1" };
    const { canUseBedrock, getAwsCredentialStatus } = await import("@/lib/aws-credentials");
    expect(await canUseBedrock(settings)).toBe(false);
    const status = await getAwsCredentialStatus(settings);
    expect(status.looksLikeFloci).toBe(true);
    expect(status.error).toMatch(/Floci placeholder/i);
  });

  it("hides a Floci endpoint override while resolving credentials", async () => {
    setEnv("AWS_ENDPOINT_URL", "http://localhost:4566");
    let seen: string | undefined = "unset";
    fromNodeProviderChain.mockReturnValue(async () => {
      seen = process.env.AWS_ENDPOINT_URL;
      return { accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "shhh" };
    });

    const { getAwsCredentialStatus } = await import("@/lib/aws-credentials");
    await getAwsCredentialStatus({ allowRealAws: true, region: "us-east-1", profile: "work-sso" });

    // A global endpoint override points the SSO client at Floci and breaks a
    // valid SSO login, so it must not be visible during resolution.
    expect(seen).toBeUndefined();
    expect(process.env.AWS_ENDPOINT_URL).toBe("http://localhost:4566");
  });

  it("scopes the credential lookup to the selected profile", async () => {
    const { getAwsCredentialStatus } = await import("@/lib/aws-credentials");
    const status = await getAwsCredentialStatus({
      allowRealAws: true,
      region: "us-east-1",
      profile: "work-sso",
    });
    expect(fromNodeProviderChain).toHaveBeenCalledWith(
      expect.objectContaining({ profile: "work-sso" }),
    );
    expect(status.profile).toBe("work-sso");
    expect(status.source).toBe("shared-profile");
  });

  it("restores the endpoint override even when the call throws", async () => {
    setEnv("AWS_ENDPOINT_URL", "http://localhost:4566");
    const { withRealAwsEndpoints } = await import("@/lib/aws-credentials");

    await expect(
      withRealAwsEndpoints(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    // A leaked deletion would permanently break every Floci-backed client.
    expect(process.env.AWS_ENDPOINT_URL).toBe("http://localhost:4566");
  });

  it("exposes a stable endpoint snapshot for memoized clients", async () => {
    // Cognito builds its client once and caches it. Reading process.env lazily
    // during a withRealAwsEndpoints() window pinned it to real AWS forever.
    const { LOCAL_AWS_ENDPOINT } = await import("@/lib/aws-endpoint");
    const { withRealAwsEndpoints } = await import("@/lib/aws-credentials");

    let seenSnapshot: string | undefined;
    let seenEnv: string | undefined = "unset";
    await withRealAwsEndpoints(async () => {
      const mod = await import("@/lib/aws-endpoint");
      seenSnapshot = mod.LOCAL_AWS_ENDPOINT;
      seenEnv = process.env.AWS_ENDPOINT_URL;
    });

    expect(seenEnv).toBeUndefined();
    expect(seenSnapshot).toBe(LOCAL_AWS_ENDPOINT);
  });

  it("never exposes a full access key in the status payload", async () => {
    const { getAwsCredentialStatus } = await import("@/lib/aws-credentials");
    const status = await getAwsCredentialStatus({ allowRealAws: true, region: "us-east-1" });
    const serialized = JSON.stringify(status);
    expect(serialized).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(serialized).not.toContain("shhh");
    expect(status.hint).toBe("…MPLE");
  });
});

describe("PUT /api/settings/providers — AWS credentials are refused", () => {
  const getIdentity = vi.fn();
  const patchInstanceConfig = vi.fn();

  beforeEach(() => {
    vi.doMock("@/lib/identity", async () => {
      const actual = await vi.importActual<typeof import("@/lib/identity")>("@/lib/identity");
      return { ...actual, getIdentity: (...a: unknown[]) => getIdentity(...a) };
    });
    vi.doMock("@/lib/instance-config", () => ({
      getPublicProviderStatus: vi.fn(),
      patchInstanceConfig: (...a: unknown[]) => patchInstanceConfig(...a),
    }));
    getIdentity.mockResolvedValue({
      userId: "admin-1",
      authenticated: true,
      role: "admin",
      groups: ["Admin"],
    });
  });

  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("@/lib/identity");
    vi.doUnmock("@/lib/instance-config");
  });

  it("rejects a pasted AWS key pair with 422 and never reaches the store", async () => {
    const { PUT } = await import("@/app/api/settings/providers/route");
    const res = await PUT(
      new NextRequest("http://localhost/api/settings/providers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bedrockAccessKeyId: "AKIAIOSFODNN7EXAMPLE",
          bedrockSecretAccessKey: "shhh",
        }),
      }),
    );
    expect(res.status).toBe(422);
    expect(patchInstanceConfig).not.toHaveBeenCalled();
  });
});
