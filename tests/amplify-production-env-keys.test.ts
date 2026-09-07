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
});
