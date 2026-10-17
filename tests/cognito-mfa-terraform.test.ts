import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const tf = readFileSync(join(process.cwd(), "infra/terraform/modules/auth_cognito/main.tf"), "utf8");

describe("Cognito user pool two-step verification settings", () => {
  it("is optional by default, so nobody is forced in or locked out", () => {
    expect(tf).toMatch(/variable "mfa_configuration"[\s\S]*?default\s*=\s*"OPTIONAL"/);
    expect(tf).toMatch(/mfa_configuration\s*=\s*var\.mfa_configuration/);
  });

  it("offers authenticator-app codes and never SMS", () => {
    expect(tf).toContain("software_token_mfa_configuration");
    expect(tf).not.toMatch(/sms_configuration|sms_mfa_configuration/);
  });

  it("accepts only OFF, OPTIONAL or ON", () => {
    expect(tf).toMatch(/contains\(\["OFF", "OPTIONAL", "ON"\], var\.mfa_configuration\)/);
  });

  it("can protect the pool from deletion, which would delete every user", () => {
    expect(tf).toMatch(/deletion_protection\s*=\s*var\.deletion_protection/);
    expect(tf).toMatch(/contains\(\["ACTIVE", "INACTIVE"\], var\.deletion_protection\)/);
  });
});
