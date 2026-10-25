import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("hosted Terraform defaults", () => {
  it("runs the chat Lambda in production mode, so dev-only identity fallbacks stay closed", () => {
    expect(read("infra/terraform/modules/api/main.tf")).toMatch(/NODE_ENV\s*=\s*"production"/);
  });

  it("refuses any auth mode other than Cognito for the hosted API", () => {
    const api = read("infra/terraform/modules/api/main.tf");
    expect(api).toMatch(/variable "auth_mode"[\s\S]*?validation[\s\S]*?var\.auth_mode == "cognito"/);
  });

  it("protects the user pool from deletion unless a sandbox opts out", () => {
    expect(read("infra/terraform/main.tf")).toMatch(
      /variable "cognito_deletion_protection"[\s\S]*?default\s*=\s*"ACTIVE"/,
    );
  });
});
