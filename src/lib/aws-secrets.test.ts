import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ssm = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock("@aws-sdk/client-ssm", () => ({
  SSMClient: class {
    send = ssm.send;
  },
  GetParameterCommand: class {
    constructor(public input: { Name: string; WithDecryption?: boolean }) {}
  },
}));
vi.mock("@/lib/aws-credentials", () => ({
  withRealAwsEndpoints: <T,>(fn: () => Promise<T>) => fn(),
}));

import {
  ensureRuntimeEnvFromSecrets,
  hydrateAppSecrets,
  resetSecretsHydrationForTests,
  secretRef,
} from "./aws-secrets";

const KEYS = ["APP_SECRETS_PARAM", "GROQ_API_KEY_PARAM", "GROQ_API_KEY", "INSTANCE_ENCRYPTION_KEY", "SETUP_CLAIM_SECRET"];
const saved: Record<string, string | undefined> = {};
const PARAM = "/securemind/prod/app-secrets";

beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  ssm.send.mockReset();
  resetSecretsHydrationForTests();
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function param(value: unknown) {
  return { Parameter: { Value: typeof value === "string" ? value : JSON.stringify(value) } };
}

describe("hydrateAppSecrets", () => {
  it("does nothing, and makes no call, when APP_SECRETS_PARAM is not set", async () => {
    expect(await hydrateAppSecrets()).toEqual([]);
    expect(ssm.send).not.toHaveBeenCalled();
  });

  it("reads the parameter decrypted, fills both values and returns only their names", async () => {
    process.env.APP_SECRETS_PARAM = PARAM;
    ssm.send.mockResolvedValue(param({ instanceEncryptionKey: "k".repeat(64), setupClaimSecret: "setup-code" }));
    const set = await hydrateAppSecrets();
    expect(set).toEqual(["INSTANCE_ENCRYPTION_KEY", "SETUP_CLAIM_SECRET"]);
    expect(process.env.INSTANCE_ENCRYPTION_KEY).toBe("k".repeat(64));
    expect(process.env.SETUP_CLAIM_SECRET).toBe("setup-code");
    expect(JSON.stringify(set)).not.toContain("setup-code");
    expect(ssm.send.mock.calls[0][0].input).toEqual({ Name: PARAM, WithDecryption: true });
  });

  it("never overrides a value that is already in the environment", async () => {
    process.env.APP_SECRETS_PARAM = PARAM;
    process.env.INSTANCE_ENCRYPTION_KEY = "from-env";
    ssm.send.mockResolvedValue(param({ instanceEncryptionKey: "from-ssm", setupClaimSecret: "code" }));
    await hydrateAppSecrets();
    expect(process.env.INSTANCE_ENCRYPTION_KEY).toBe("from-env");
    expect(process.env.SETUP_CLAIM_SECRET).toBe("code");
  });

  it("makes no call when both values are already present", async () => {
    process.env.APP_SECRETS_PARAM = PARAM;
    process.env.INSTANCE_ENCRYPTION_KEY = "a";
    process.env.SETUP_CLAIM_SECRET = "b";
    expect(await hydrateAppSecrets()).toEqual([]);
    expect(ssm.send).not.toHaveBeenCalled();
  });

  it("skips a missing or blank field rather than setting an empty value", async () => {
    process.env.APP_SECRETS_PARAM = PARAM;
    ssm.send.mockResolvedValue(param({ instanceEncryptionKey: "  ", setupClaimSecret: "code" }));
    expect(await hydrateAppSecrets()).toEqual(["SETUP_CLAIM_SECRET"]);
    expect(process.env.INSTANCE_ENCRYPTION_KEY).toBeUndefined();
  });

  it("fails clearly when the parameter is empty or not a JSON object", async () => {
    process.env.APP_SECRETS_PARAM = PARAM;
    for (const bad of ["plain text", "[1,2]", "", "   "]) {
      ssm.send.mockResolvedValue(param(bad));
      await expect(hydrateAppSecrets(), JSON.stringify(bad)).rejects.toThrow(/APP_SECRETS_PARAM/);
    }
  });
});

describe("secretRef", () => {
  it("names the parameter, trimmed, or nothing", () => {
    expect(secretRef("APP_SECRETS_PARAM")).toBeNull();
    process.env.APP_SECRETS_PARAM = " /p ";
    expect(secretRef("APP_SECRETS_PARAM")).toEqual({ kind: "ssm", id: "/p" });
  });
});

describe("ensureRuntimeEnvFromSecrets", () => {
  it("fills the bootstrap Groq key from its parameter", async () => {
    process.env.GROQ_API_KEY_PARAM = "/securemind/prod/groq-api-key";
    ssm.send.mockResolvedValue(param("gsk_test_value"));
    await ensureRuntimeEnvFromSecrets();
    expect(process.env.GROQ_API_KEY).toBe("gsk_test_value");
  });

  it("runs once for many callers", async () => {
    process.env.APP_SECRETS_PARAM = PARAM;
    ssm.send.mockResolvedValue(param({ instanceEncryptionKey: "k", setupClaimSecret: "s" }));
    await Promise.all([ensureRuntimeEnvFromSecrets(), ensureRuntimeEnvFromSecrets()]);
    await ensureRuntimeEnvFromSecrets();
    expect(ssm.send).toHaveBeenCalledTimes(1);
  });

  it("forgets a failed attempt so the next call retries", async () => {
    process.env.APP_SECRETS_PARAM = PARAM;
    ssm.send.mockRejectedValueOnce(new Error("throttled"));
    await expect(ensureRuntimeEnvFromSecrets()).rejects.toThrow("throttled");
    ssm.send.mockResolvedValue(param({ instanceEncryptionKey: "k", setupClaimSecret: "s" }));
    await ensureRuntimeEnvFromSecrets();
    expect(process.env.INSTANCE_ENCRYPTION_KEY).toBe("k");
  });

  it("is a no-op with no parameter configured, which is every local install", async () => {
    await ensureRuntimeEnvFromSecrets();
    expect(ssm.send).not.toHaveBeenCalled();
  });
});
