/**
 * Directory / Cognito password rules for this runtime.
 *
 * Hosted Cognito (terraform auth_cognito): min 12, upper + lower + number.
 * Local Floci: min 8, no character-class requirements.
 *
 * Call `directoryPasswordPolicy()` only on the server. Client UI must use the
 * policy object returned by `/api/admin/users` (or `/api/me/security`).
 */

import { isHostedRuntime } from "@/lib/runtime-env";

export type DirectoryPasswordPolicy = {
  minLength: number;
  requireUppercase: boolean;
  requireLowercase: boolean;
  requireNumber: boolean;
  requireSymbol: boolean;
  summary: string;
  rules: string[];
};

export function directoryPasswordPolicy(): DirectoryPasswordPolicy {
  if (isHostedRuntime()) {
    return {
      minLength: 12,
      requireUppercase: true,
      requireLowercase: true,
      requireNumber: true,
      requireSymbol: false,
      summary:
        "At least 12 characters, including uppercase, lowercase, and a number. Symbols are optional.",
      rules: [
        "At least 12 characters",
        "At least one uppercase letter (A–Z)",
        "At least one lowercase letter (a–z)",
        "At least one number (0–9)",
        "Symbols are optional",
      ],
    };
  }
  return {
    minLength: 8,
    requireUppercase: false,
    requireLowercase: false,
    requireNumber: false,
    requireSymbol: false,
    summary: "At least 8 characters. This local pool does not require mixed character classes.",
    rules: ["At least 8 characters"],
  };
}

export type PasswordCheck = { ok: true } | { ok: false; error: string };

export function checkPasswordAgainstPolicy(
  password: string,
  policy: DirectoryPasswordPolicy,
): PasswordCheck {
  if (!password) {
    return { ok: false, error: "Password is required." };
  }
  if (password.length < policy.minLength) {
    return { ok: false, error: `Password must be at least ${policy.minLength} characters.` };
  }
  if (policy.requireLowercase && !/[a-z]/.test(password)) {
    return { ok: false, error: "Password must include a lowercase letter (a–z)." };
  }
  if (policy.requireUppercase && !/[A-Z]/.test(password)) {
    return { ok: false, error: "Password must include an uppercase letter (A–Z)." };
  }
  if (policy.requireNumber && !/[0-9]/.test(password)) {
    return { ok: false, error: "Password must include a number (0–9)." };
  }
  if (policy.requireSymbol && !/[^A-Za-z0-9]/.test(password)) {
    return { ok: false, error: "Password must include a symbol." };
  }
  return { ok: true };
}

export function validateDirectoryPassword(password: string): PasswordCheck {
  return checkPasswordAgainstPolicy(password, directoryPasswordPolicy());
}

export type PasswordRuleId =
  | "length"
  | "uppercase"
  | "lowercase"
  | "number"
  | "symbol";

export function passwordRuleMet(
  password: string,
  policy: DirectoryPasswordPolicy,
  rule: PasswordRuleId,
): boolean {
  switch (rule) {
    case "length":
      return password.length >= policy.minLength;
    case "uppercase":
      return !policy.requireUppercase || /[A-Z]/.test(password);
    case "lowercase":
      return !policy.requireLowercase || /[a-z]/.test(password);
    case "number":
      return !policy.requireNumber || /[0-9]/.test(password);
    case "symbol":
      return !policy.requireSymbol || /[^A-Za-z0-9]/.test(password);
    default:
      return true;
  }
}

export function passwordChecklist(policy: DirectoryPasswordPolicy): Array<{
  id: PasswordRuleId;
  label: string;
  required: boolean;
}> {
  const items: Array<{ id: PasswordRuleId; label: string; required: boolean }> = [
    { id: "length", label: `At least ${policy.minLength} characters`, required: true },
  ];
  if (policy.requireUppercase) {
    items.push({ id: "uppercase", label: "One uppercase letter (A–Z)", required: true });
  }
  if (policy.requireLowercase) {
    items.push({ id: "lowercase", label: "One lowercase letter (a–z)", required: true });
  }
  if (policy.requireNumber) {
    items.push({ id: "number", label: "One number (0–9)", required: true });
  }
  if (policy.requireSymbol) {
    items.push({ id: "symbol", label: "One symbol", required: true });
  } else if (policy.requireUppercase || policy.requireLowercase || policy.requireNumber) {
    items.push({ id: "symbol", label: "Symbols are optional", required: false });
  }
  return items;
}

const GEN_UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const GEN_LOWER = "abcdefghjkmnpqrstuvwxyz";
const GEN_DIGIT = "23456789";
const GEN_SYMBOL = "-_.!#";

/** Uniform random index below `n`, without modulo bias. */
function randomBelow(n: number): number {
  const limit = Math.floor(0x100000000 / n) * n;
  const buf = new Uint32Array(1);
  do {
    globalThis.crypto.getRandomValues(buf);
  } while (buf[0] >= limit);
  return buf[0] % n;
}

/**
 * A random password that meets the directory policy. Leaves out look-alike characters (0/O, 1/l/I) so
 * an admin can read it aloud or retype it. Uses the browser's or server's secure random source.
 */
export function generateDirectoryPassword(policy: DirectoryPasswordPolicy, length = 16): string {
  const size = Math.max(length, policy.minLength);
  const pools = [GEN_UPPER, GEN_LOWER, GEN_DIGIT];
  if (policy.requireSymbol) pools.push(GEN_SYMBOL);
  const all = GEN_UPPER + GEN_LOWER + GEN_DIGIT;
  const chars = pools.map(pool => pool[randomBelow(pool.length)]);
  while (chars.length < size) chars.push(all[randomBelow(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomBelow(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}
