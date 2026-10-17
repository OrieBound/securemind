import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sm = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock("@aws-sdk/client-secrets-manager", () => ({
  SecretsManagerClient: class {
    send = sm.send;
  },
  GetSecretValueCommand: class {
    constructor(public input: { SecretId: string }) {}
  },
}));
vi.mock("@/lib/aws-credentials", () => ({
  withRealAwsEndpoints: <T,>(fn: () => Promise<T>) => fn(),
}));

import {
  ensureRuntimeEnvFromSecrets,
  hydrateAppSecrets,
  resetSecretsHydrationForTests,
} from "./aws-secrets";

const KEYS = ["APP_SECRETS_ARN", "INSTANCE_ENCRYPTION_KEY", "SETUP_CLAIM_SECRET", "DATABASE_SECRET_ARN", "GROQ_SECRET_ARN", "FRAGMENTS_TABLE_SECRET_ARN"];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  sm.send.mockReset();
  resetSecretsHydrationForTests();
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function secret(obj: unknown) {
  return { SecretString: typeof obj === "string" ? obj : JSON.stringify(obj) };
}

describe("hydrateAppSecrets", () => {
  it("does nothing, and makes no call, when APP_SECRETS_ARN is not set", async () => {
    expect(await hydrateAppSecrets()).toEqual([]);
    expect(sm.send).not.toHaveBeenCalled();
  });

  it("fills both values from the secret and returns only their names", async () => {
    process.env.APP_SECRETS_ARN = "arn:aws:secretsmanager:us-east-1:123456789012:secret:app";
    sm.send.mockResolvedValue(secret({ instanceEncryptionKey: "k".repeat(64), setupClaimSecret: "setup-code" }));
    const set = await hydrateAppSecrets();
    expect(set).toEqual(["INSTANCE_ENCRYPTION_KEY", "SETUP_CLAIM_SECRET"]);
    expect(process.env.INSTANCE_ENCRYPTION_KEY).toBe("k".repeat(64));
    expect(process.env.SETUP_CLAIM_SECRET).toBe("setup-code");
    expect(JSON.stringify(set)).not.toContain("setup-code");
  });

  it("never overrides a value that is already in the environment", async () => {
    process.env.APP_SECRETS_ARN = "arn:x";
    process.env.INSTANCE_ENCRYPTION_KEY = "from-env";
    sm.send.mockResolvedValue(secret({ instanceEncryptionKey: "from-sm", setupClaimSecret: "code" }));
    await hydrateAppSecrets();
    expect(process.env.INSTANCE_ENCRYPTION_KEY).toBe("from-env");
    expect(process.env.SETUP_CLAIM_SECRET).toBe("code");
  });

  it("makes no call when both values are already present", async () => {
    process.env.APP_SECRETS_ARN = "arn:x";
    process.env.INSTANCE_ENCRYPTION_KEY = "a";
    process.env.SETUP_CLAIM_SECRET = "b";
    expect(await hydrateAppSecrets()).toEqual([]);
    expect(sm.send).not.toHaveBeenCalled();
  });

  it("skips a missing or blank field rather than setting an empty value", async () => {
    process.env.APP_SECRETS_ARN = "arn:x";
    sm.send.mockResolvedValue(secret({ instanceEncryptionKey: "  ", setupClaimSecret: "code" }));
    expect(await hydrateAppSecrets()).toEqual(["SETUP_CLAIM_SECRET"]);
    expect(process.env.INSTANCE_ENCRYPTION_KEY).toBeUndefined();
  });

  it("fails clearly when the secret is not a JSON object", async () => {
    process.env.APP_SECRETS_ARN = "arn:x";
    for (const bad of ["plain text", "[1,2]", "", "   "]) {
      sm.send.mockResolvedValue(secret(bad));
      await expect(hydrateAppSecrets(), JSON.stringify(bad)).rejects.toThrow(/APP_SECRETS_ARN/);
    }
  });
});

describe("ensureRuntimeEnvFromSecrets", () => {
  it("runs once for many callers", async () => {
    process.env.APP_SECRETS_ARN = "arn:x";
    sm.send.mockResolvedValue(secret({ instanceEncryptionKey: "k", setupClaimSecret: "s" }));
    await Promise.all([ensureRuntimeEnvFromSecrets(), ensureRuntimeEnvFromSecrets()]);
    await ensureRuntimeEnvFromSecrets();
    expect(sm.send).toHaveBeenCalledTimes(1);
  });

  it("forgets a failed attempt so the next call retries", async () => {
    process.env.APP_SECRETS_ARN = "arn:x";
    sm.send.mockRejectedValueOnce(new Error("throttled"));
    await expect(ensureRuntimeEnvFromSecrets()).rejects.toThrow("throttled");
    sm.send.mockResolvedValue(secret({ instanceEncryptionKey: "k", setupClaimSecret: "s" }));
    await ensureRuntimeEnvFromSecrets();
    expect(process.env.INSTANCE_ENCRYPTION_KEY).toBe("k");
  });

  it("is a no-op with no ARNs configured, which is every local install", async () => {
    await ensureRuntimeEnvFromSecrets();
    expect(sm.send).not.toHaveBeenCalled();
  });
});
