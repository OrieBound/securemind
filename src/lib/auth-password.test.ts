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
