import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ensure = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("@/lib/aws-secrets", () => ({ ensureRuntimeEnvFromSecrets: () => ensure.fn() }));

import { register } from "../src/instrumentation";

const KEYS = ["NEXT_RUNTIME", "NEXT_PHASE", "APP_SECRETS_ARN"];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  ensure.fn.mockReset();
  ensure.fn.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("instrumentation register()", () => {
  it("loads the secrets on the Node server when APP_SECRETS_ARN is set", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    process.env.APP_SECRETS_ARN = "arn:x";
    await register();
    expect(ensure.fn).toHaveBeenCalledTimes(1);
  });

  it("does nothing without an ARN, in the edge runtime, or during next build", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    await register();
    process.env.APP_SECRETS_ARN = "arn:x";
    process.env.NEXT_RUNTIME = "edge";
    await register();
    process.env.NEXT_RUNTIME = "nodejs";
    process.env.NEXT_PHASE = "phase-production-build";
    await register();
    expect(ensure.fn).not.toHaveBeenCalled();
  });

  it("retries a transient failure and then succeeds", async () => {
    vi.useFakeTimers();
    process.env.NEXT_RUNTIME = "nodejs";
    process.env.APP_SECRETS_ARN = "arn:x";
    ensure.fn.mockRejectedValueOnce(new Error("throttled")).mockResolvedValue(undefined);
    const done = register();
    await vi.runAllTimersAsync();
    await done;
    expect(ensure.fn).toHaveBeenCalledTimes(2);
  });

  it("gives up after three attempts without throwing, so the server still boots", async () => {
    vi.useFakeTimers();
    process.env.NEXT_RUNTIME = "nodejs";
    process.env.APP_SECRETS_ARN = "arn:x";
    ensure.fn.mockRejectedValue(new Error("denied"));
    const done = register();
    await vi.runAllTimersAsync();
    await expect(done).resolves.toBeUndefined();
    expect(ensure.fn).toHaveBeenCalledTimes(3);
  });

  it("logs the error name only, never a message that could contain a secret", async () => {
    vi.useFakeTimers();
    process.env.NEXT_RUNTIME = "nodejs";
    process.env.APP_SECRETS_ARN = "arn:x";
    ensure.fn.mockRejectedValue(new Error("secret-value-in-message"));
    const done = register();
    await vi.runAllTimersAsync();
    await done;
    const logged = vi.mocked(console.error).mock.calls.flat().join(" ");
    expect(logged).not.toContain("secret-value-in-message");
  });
});
