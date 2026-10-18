import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("stored secrets use Parameter Store, not Secrets Manager", () => {
  const secrets = read("infra/terraform/modules/secrets/main.tf");
  const amplify = read("infra/terraform/modules/amplify/main.tf");
  const api = read("infra/terraform/modules/api/main.tf");

  it("creates no Secrets Manager secret in the app install", () => {
    for (const tf of [secrets, amplify, api]) {
      expect(tf).not.toMatch(/resource "aws_secretsmanager_secret"/);
    }
  });

  it("keeps every stored value an encrypted SecureString", () => {
    const params = [...secrets.matchAll(/resource "aws_ssm_parameter" "(\w+)" \{([\s\S]*?)\n\}/g)];
    expect(params.map(m => m[1]).sort()).toEqual(["groq", "vendor_keys"]);
    for (const [, name, body] of params) {
      expect(body, name).toMatch(/type\s*=\s*"SecureString"/);
    }
  });

  it("does not keep a copy of the table name, which is not a secret", () => {
    expect(secrets).not.toMatch(/fragments/i);
    expect(api).not.toMatch(/FRAGMENTS_TABLE_SECRET_ARN/);
    expect(api).toMatch(/DYNAMODB_FRAGMENTS_TABLE\s*=\s*var\.fragments_table_name/);
  });

  it("lets the chat Lambda read, but not write, the parameters", () => {
    expect(api).toMatch(/ssm:GetParameter/);
    expect(api).not.toMatch(/ssm:PutParameter/);
  });

  it("lets only the Amplify role write the vendor keys, and only that parameter", () => {
    expect(amplify).toMatch(/VendorKeysParameter[\s\S]*?ssm:PutParameter[\s\S]*?var\.vendor_keys_param_arn/);
  });
});
