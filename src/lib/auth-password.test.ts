import { afterEach, describe, expect, it, vi } from "vitest";

const isHostedRuntime = vi.fn(() => false);

vi.mock("@/lib/runtime-env", () => ({
  isHostedRuntime: () => isHostedRuntime(),
}));

afterEach(() => {
  isHostedRuntime.mockReturnValue(false);
  vi.resetModules();
});

describe("directoryPasswordPolicy", () => {
  it("uses Floci-style rules locally", async () => {
    isHostedRuntime.mockReturnValue(false);
    const { directoryPasswordPolicy, validateDirectoryPassword } = await import(
      "@/lib/auth-password"
    );
    const policy = directoryPasswordPolicy();
    expect(policy.minLength).toBe(8);
    expect(policy.requireUppercase).toBe(false);
    expect(validateDirectoryPassword("short").ok).toBe(false);
    expect(validateDirectoryPassword("12345678").ok).toBe(true);
  });

  it("uses hosted Cognito rules on cloud", async () => {
    isHostedRuntime.mockReturnValue(true);
    const { directoryPasswordPolicy, validateDirectoryPassword } = await import(
      "@/lib/auth-password"
    );
    const policy = directoryPasswordPolicy();
    expect(policy.minLength).toBe(12);
    expect(policy.requireUppercase).toBe(true);
    expect(policy.requireLowercase).toBe(true);
    expect(policy.requireNumber).toBe(true);
    expect(validateDirectoryPassword("abcdefghijkl").ok).toBe(false);
    const missingUpper = validateDirectoryPassword("abcdefghi123");
    expect(missingUpper.ok).toBe(false);
    if (!missingUpper.ok) expect(missingUpper.error).toMatch(/uppercase/i);
    expect(validateDirectoryPassword("Abcdefghi123").ok).toBe(true);
  });
});

describe("checkPasswordAgainstPolicy", () => {
  it("is client-safe against a supplied policy object", async () => {
    const { checkPasswordAgainstPolicy, passwordRuleMet } = await import("@/lib/auth-password");
    const hosted = {
      minLength: 12,
      requireUppercase: true,
      requireLowercase: true,
      requireNumber: true,
      requireSymbol: false,
      summary: "hosted",
      rules: [],
    };
    expect(checkPasswordAgainstPolicy("Abcdefghi123", hosted).ok).toBe(true);
    expect(passwordRuleMet("Abcdefghi123", hosted, "length")).toBe(true);
    expect(passwordRuleMet("short", hosted, "length")).toBe(false);
  });
});

describe("generateDirectoryPassword", () => {
  it("meets the hosted policy every time and avoids look-alike characters", async () => {
    isHostedRuntime.mockReturnValue(true);
    const { directoryPasswordPolicy, generateDirectoryPassword, checkPasswordAgainstPolicy } = await import("./auth-password");
    const policy = directoryPasswordPolicy();
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const pw = generateDirectoryPassword(policy);
      expect(checkPasswordAgainstPolicy(pw, policy)).toEqual({ ok: true });
      expect(pw).not.toMatch(/[01OIl]/);
      seen.add(pw);
    }
    expect(seen.size).toBe(200);
  });

  it("meets the local policy and respects a longer length", async () => {
    const { directoryPasswordPolicy, generateDirectoryPassword } = await import("./auth-password");
    const policy = directoryPasswordPolicy();
    expect(generateDirectoryPassword(policy).length).toBe(16);
    expect(generateDirectoryPassword(policy, 24).length).toBe(24);
    expect(generateDirectoryPassword(policy, 4).length).toBe(policy.minLength);
  });
});
