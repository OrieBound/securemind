import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Amplify production env keys", () => {
  it("bakes AVATAR_S3_BUCKET in both build specs so hosted photos reach S3", () => {
    const keys = JSON.parse(
      readFileSync(join(process.cwd(), "infra/scripts/amplify-production-env-keys.json"), "utf8"),
    ) as string[];
    expect(keys).toContain("AVATAR_S3_BUCKET");
    const yml = readFileSync(join(process.cwd(), "amplify.yml"), "utf8");
    const tf = readFileSync(join(process.cwd(), "infra/terraform/modules/amplify/main.tf"), "utf8");
    expect(yml).toContain("amplify-production-env-keys.json");
    expect(tf).toContain("amplify-production-env-keys.json");
    expect(tf).toMatch(/AVATAR_S3_BUCKET\s*=\s*var\.avatar_s3_bucket_name/);
  });

  it("keeps the encryption key and setup code out of Amplify variables and the build output", () => {
    const keys = JSON.parse(
      readFileSync(join(process.cwd(), "infra/scripts/amplify-production-env-keys.json"), "utf8"),
    ) as string[];
    // The secrets are read from Secrets Manager at startup, so only the ARN is baked in.
    expect(keys).not.toContain("INSTANCE_ENCRYPTION_KEY");
    expect(keys).not.toContain("SETUP_CLAIM_SECRET");
    expect(keys).toContain("APP_SECRETS_ARN");

    const tf = readFileSync(join(process.cwd(), "infra/terraform/modules/amplify/main.tf"), "utf8");
    expect(tf).not.toMatch(/^\s*INSTANCE_ENCRYPTION_KEY\s*=/m);
    expect(tf).not.toMatch(/^\s*SETUP_CLAIM_SECRET\s*=/m);
    expect(tf).toMatch(/APP_SECRETS_ARN\s*=\s*aws_secretsmanager_secret\.app_secrets\.arn/);
    // The compute role may read exactly that secret, and nothing broader.
    expect(tf).toMatch(/ReadAppSecrets[\s\S]*?secretsmanager:GetSecretValue[\s\S]*?aws_secretsmanager_secret\.app_secrets\.arn/);
  });
});
