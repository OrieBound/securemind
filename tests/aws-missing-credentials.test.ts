import { describe, expect, it } from "vitest";
import { explainMissingCredentials } from "@/lib/aws-credentials";

const base = { docker: true, profile: null, availableProfiles: [] as string[], sharedConfigFound: false, placeholdersPresent: true };

describe("explainMissingCredentials (Docker)", () => {
  it("says nothing is shared when no AWS folder is visible", () => {
    const text = explainMissingCredentials({ ...base, profile: "work" });
    expect(text).toContain("not sharing an AWS profile");
    expect(text).toContain("npm run bedrock:profile -- work");
    expect(text).toContain("docker-compose.bedrock.yml");
  });

  it("says the chosen profile is not in the shared folder", () => {
    const text = explainMissingCredentials({ ...base, profile: "work", sharedConfigFound: true, availableProfiles: ["other"] });
    expect(text).toContain('Profile "work" is not in the folder shared with Docker');
  });

  it("says the sign-in expired when the profile is shared but unusable", () => {
    const text = explainMissingCredentials({ ...base, profile: "work", sharedConfigFound: true, availableProfiles: ["work"] });
    expect(text).toContain("sign-in is missing or has expired");
    expect(text).toContain("aws sso login --profile work");
  });

  it("asks for a profile when shared profiles exist but none is chosen", () => {
    const text = explainMissingCredentials({ ...base, sharedConfigFound: true, availableProfiles: ["work"] });
    expect(text).toContain("Choose one of the shared profiles");
  });
});

describe("explainMissingCredentials (not Docker)", () => {
  it("keeps the simple sign-in advice", () => {
    expect(explainMissingCredentials({ ...base, docker: false, profile: "work" })).toBe(
      'Profile "work" has no usable credentials. Try: aws sso login --profile work',
    );
    expect(explainMissingCredentials({ ...base, docker: false, placeholdersPresent: false })).toContain("No AWS credentials found");
  });
});
