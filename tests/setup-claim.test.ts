/**
 * First-run claim / setup status. No userId from the body; hosted code never leaks.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const cognitoAdminAvailable = vi.fn();
const cognitoDirectoryIsEmpty = vi.fn();
const claimFirstAdmin = vi.fn();
const getInstanceSetupPersist = vi.fn();
const markSetupClaimUsed = vi.fn();
const completeInstanceSetup = vi.fn();
const cognitoLogin = vi.fn();
const ensureUserProfile = vi.fn();
const getIdentity = vi.fn();

vi.mock("@/lib/cognito-admin", () => ({
  CognitoAdminError: class CognitoAdminError extends Error {
    status: number;
    constructor(message: string, status = 400) {
      super(message);
      this.status = status;
    }
  },
  cognitoAdminAvailable: (...args: unknown[]) => cognitoAdminAvailable(...args),
  cognitoDirectoryIsEmpty: (...args: unknown[]) => cognitoDirectoryIsEmpty(...args),
  claimFirstAdmin: (...args: unknown[]) => claimFirstAdmin(...args),
}));

vi.mock("@/lib/instance-config", () => ({
  getInstanceSetupPersist: (...args: unknown[]) => getInstanceSetupPersist(...args),
  markSetupClaimUsed: (...args: unknown[]) => markSetupClaimUsed(...args),
  completeInstanceSetup: (...args: unknown[]) => completeInstanceSetup(...args),
}));

vi.mock("@/lib/cognito", () => ({
  cognitoConfigured: () => true,
  cognitoLogin: (...args: unknown[]) => cognitoLogin(...args),
}));

vi.mock("@/lib/user-profile", () => ({
  ensureUserProfile: (...args: unknown[]) => ensureUserProfile(...args),
}));

vi.mock("@/lib/identity", async () => {
  const actual = await vi.importActual<typeof import("@/lib/identity")>("@/lib/identity");
  return {
    ...actual,
    getIdentity: (...args: unknown[]) => getIdentity(...args),
  };
});

const savedEnv: Record<string, string | undefined> = {};

function stashEnv(keys: string[]) {
  for (const k of keys) savedEnv[k] = process.env[k];
}

function restoreEnv(keys: string[]) {
  for (const k of keys) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
}

const ENV_KEYS = [
  "SECUREMIND_EDITION",
  "AMPLIFY_HOSTING",
  "AWS_LAMBDA_FUNCTION_NAME",
  "SETUP_CLAIM_SECRET",
  "AUTH_MODE",
  "STORAGE_BACKEND",
];

beforeEach(() => {
  vi.clearAllMocks();
  stashEnv(ENV_KEYS);
  delete process.env.SECUREMIND_EDITION;
  delete process.env.AMPLIFY_HOSTING;
  delete process.env.AWS_LAMBDA_FUNCTION_NAME;
  delete process.env.SETUP_CLAIM_SECRET;
  process.env.AUTH_MODE = "cognito";
  getInstanceSetupPersist.mockResolvedValue({
    setupCompletedAt: null,
    setupClaimUsedAt: null,
    storageBackend: null,
  });
  cognitoAdminAvailable.mockReturnValue(true);
  cognitoDirectoryIsEmpty.mockResolvedValue(true);
  markSetupClaimUsed.mockResolvedValue(true);
  completeInstanceSetup.mockResolvedValue(true);
  cognitoLogin.mockResolvedValue({
    accessToken: "tok",
    expiresIn: 3600,
  });
  claimFirstAdmin.mockResolvedValue({
    username: "owner@example.com",
    sub: "sub-owner",
    email: "owner@example.com",
    enabled: true,
    status: "CONFIRMED",
    role: "super_admin",
    groups: ["Admin", "Owner"],
    createdAt: null,
    isOwner: true,
  });
  ensureUserProfile.mockResolvedValue({});
});

afterEach(() => {
  restoreEnv(ENV_KEYS);
});

function jsonReq(url: string, body: unknown) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/setup/status", () => {
  it("does not leak SETUP_CLAIM_SECRET", async () => {
    process.env.SETUP_CLAIM_SECRET = "super-secret-setup-code-never-leak";
    const { GET } = await import("@/app/api/setup/status/route");
    const res = await GET(new NextRequest("http://localhost/api/setup/status"));
    const text = await res.text();
    expect(text).not.toContain("super-secret-setup-code-never-leak");
    const data = JSON.parse(text) as Record<string, unknown>;
    expect(data.setupComplete).toBe(false);
    expect(data.claimAvailable).toBe(true);
    expect(data).not.toHaveProperty("setupCode");
    expect(data).not.toHaveProperty("SETUP_CLAIM_SECRET");
  });

  it("offers hosted claim when the directory cannot be listed", async () => {
    process.env.SECUREMIND_EDITION = "cloud";
    process.env.SETUP_CLAIM_SECRET = "super-secret-setup-code-never-leak";
    cognitoDirectoryIsEmpty.mockRejectedValue(new Error("timeout listing Cognito users"));
    const { GET } = await import("@/app/api/setup/status/route");
    const res = await GET(new NextRequest("http://localhost/api/setup/status"));
    const data = await res.json() as { claimAvailable?: boolean; directoryEmpty?: boolean | null };
    expect(data.directoryEmpty).toBeNull();
    expect(data.claimAvailable).toBe(true);
  });
});

describe("POST /api/setup/claim", () => {
  const validLocal = {
    email: "owner@example.com",
    emailConfirm: "owner@example.com",
    password: "choose-your-own",
    passwordConfirm: "choose-your-own",
  };

  it("creates the first owner on local without a setup code", async () => {
    const { POST } = await import("@/app/api/setup/claim/route");
    const res = await POST(jsonReq("http://localhost/api/setup/claim", validLocal));
    expect(res.status).toBe(200);
    expect(claimFirstAdmin).toHaveBeenCalledWith({
      email: "owner@example.com",
      password: "choose-your-own",
    });
    const data = await res.json() as { accessToken?: string };
    expect(data.accessToken).toBe("tok");
  });

  it("ignores a client-supplied userId", async () => {
    const { POST } = await import("@/app/api/setup/claim/route");
    await POST(jsonReq("http://localhost/api/setup/claim", {
      ...validLocal,
      userId: "attacker-sub",
    }));
    expect(claimFirstAdmin).toHaveBeenCalledWith({
      email: "owner@example.com",
      password: "choose-your-own",
    });
    expect(JSON.stringify(claimFirstAdmin.mock.calls)).not.toContain("attacker-sub");
  });

  it("returns 409 when the directory is not empty", async () => {
    cognitoDirectoryIsEmpty.mockResolvedValue(false);
    const { POST } = await import("@/app/api/setup/claim/route");
    const res = await POST(jsonReq("http://localhost/api/setup/claim", validLocal));
    expect(res.status).toBe(409);
    expect(claimFirstAdmin).not.toHaveBeenCalled();
  });

  it("returns 409 when a claim was already persisted", async () => {
    getInstanceSetupPersist.mockResolvedValue({
      setupCompletedAt: null,
      setupClaimUsedAt: new Date(),
      storageBackend: null,
    });
    const { POST } = await import("@/app/api/setup/claim/route");
    const res = await POST(jsonReq("http://localhost/api/setup/claim", validLocal));
    expect(res.status).toBe(409);
    expect(claimFirstAdmin).not.toHaveBeenCalled();
  });

  it("rejects a wrong hosted setup code", async () => {
    process.env.SECUREMIND_EDITION = "cloud";
    process.env.SETUP_CLAIM_SECRET = "CorrectHostedSetupCodeValue99";
    const { POST } = await import("@/app/api/setup/claim/route");
    const res = await POST(jsonReq("http://localhost/api/setup/claim", {
      email: "owner@example.com",
      emailConfirm: "owner@example.com",
      password: "ValidPass12",
      passwordConfirm: "ValidPass12",
      setupCode: "wrong-code",
    }));
    expect(res.status).toBe(403);
    const data = await res.json() as { error?: string };
    expect(data.error).toBe("Invalid setup code.");
    expect(claimFirstAdmin).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/signup", () => {
  it("is disabled in favor of first-run claim", async () => {
    const { POST } = await import("@/app/api/auth/signup/route");
    const res = await POST(jsonReq("http://localhost/api/auth/signup", {
      email: "anyone@example.com",
      password: "whatever1",
    }));
    expect(res.status).toBe(403);
  });
});

describe("POST /api/setup/complete", () => {
  it("requires an authenticated identity, not a body userId", async () => {
    getIdentity.mockResolvedValue({
      userId: "sub-owner",
      authenticated: true,
      email: "owner@example.com",
      role: "super_admin",
      groups: ["Owner"],
    });
    const { POST } = await import("@/app/api/setup/complete/route");
    const res = await POST(jsonReq("http://localhost/api/setup/complete", {
      storageBackend: "postgres",
      riskAck: true,
      userId: "attacker-sub",
    }));
    expect(res.status).toBe(200);
    expect(completeInstanceSetup).toHaveBeenCalledWith({
      storageBackend: "postgres",
      userId: "sub-owner",
    });
  });

  it("persists DynamoDB on a hosted install even if the client sends SQL", async () => {
    process.env.SECUREMIND_EDITION = "cloud";
    getIdentity.mockResolvedValue({
      userId: "sub-owner",
      authenticated: true,
      email: "owner@example.com",
      role: "super_admin",
      groups: ["Owner"],
    });
    const { POST } = await import("@/app/api/setup/complete/route");
    const res = await POST(jsonReq("http://localhost/api/setup/complete", {
      storageBackend: "neon",
      riskAck: true,
    }));
    expect(res.status).toBe(200);
    expect(completeInstanceSetup).toHaveBeenCalledWith({
      storageBackend: "dynamodb",
      userId: "sub-owner",
    });
  });

  it("maps Postgres on a hosted install to DynamoDB", async () => {
    process.env.SECUREMIND_EDITION = "cloud";
    getIdentity.mockResolvedValue({
      userId: "sub-owner",
      authenticated: true,
      email: "owner@example.com",
      role: "super_admin",
      groups: ["Owner"],
    });
    const { POST } = await import("@/app/api/setup/complete/route");
    const res = await POST(jsonReq("http://localhost/api/setup/complete", {
      storageBackend: "postgres",
      riskAck: true,
    }));
    expect(res.status).toBe(200);
    expect(completeInstanceSetup).toHaveBeenCalledWith({
      storageBackend: "dynamodb",
      userId: "sub-owner",
    });
  });
});
