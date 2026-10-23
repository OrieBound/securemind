import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { extractProfile, ssoCacheFileName } from "../scripts/lib/aws-profile-export.mjs";

const CONFIG = `[default]
region = us-east-1

[profile alpha]
sso_session = team-sso
sso_account_id = 111111111111
sso_role_name = ReadOnly
region = us-east-1

[profile beta]
sso_session = team-sso
sso_account_id = 222222222222
sso_role_name = Admin

[profile keys-only]
aws_access_key_id = AKIAEXAMPLEEXAMPLE00
aws_secret_access_key = example

[profile legacy]
sso_start_url = https://example.awsapps.com/start
sso_region = us-east-1
sso_account_id = 333333333333
sso_role_name = Dev

[sso-session team-sso]
sso_start_url = https://example.awsapps.com/start
sso_region = us-east-1
sso_registration_scopes = sso:account:access
`;

describe("extractProfile", () => {
  it("keeps only the chosen profile and its sso-session", () => {
    const r = extractProfile(CONFIG, "alpha");
    expect(r.ok).toBe(true);
    expect(r.text).toContain("[profile alpha]");
    expect(r.text).toContain("[sso-session team-sso]");
    expect(r.text).not.toContain("beta");
    expect(r.text).not.toContain("222222222222");
    expect(r.text).not.toContain("keys-only");
    expect(r.cacheFile).toBe(createHash("sha1").update("team-sso").digest("hex") + ".json");
  });

  it("uses the start URL for older profiles with no sso-session", () => {
    const r = extractProfile(CONFIG, "legacy");
    expect(r.ok).toBe(true);
    expect(r.cacheFile).toBe(ssoCacheFileName("https://example.awsapps.com/start"));
    expect(r.text).not.toContain("alpha");
  });

  it("refuses a profile that holds access keys, and never copies them", () => {
    const r = extractProfile(CONFIG, "keys-only");
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("AKIAEXAMPLE");
  });

  it("says so when the profile does not exist", () => {
    const r = extractProfile(CONFIG, "nope");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/No profile named "nope"/);
  });
});
