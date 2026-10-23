import { describe, expect, it } from "vitest";
import { isAwsHostedEndpoint } from "@/lib/aws-endpoint";
import { THEME_BOOT_SCRIPT } from "@/lib/theme";
import { redactArgs } from "../infra/scripts/lib.mjs";

describe("isAwsHostedEndpoint", () => {
  it("accepts real AWS hosts", () => {
    expect(isAwsHostedEndpoint("https://cognito-idp.us-east-1.amazonaws.com")).toBe(true);
    expect(isAwsHostedEndpoint("https://bedrock-runtime.eu-west-1.amazonaws.com/model")).toBe(true);
    expect(isAwsHostedEndpoint("https://cognito-idp.cn-north-1.amazonaws.com.cn")).toBe(true);
  });

  it("refuses local stubs and lookalikes", () => {
    expect(isAwsHostedEndpoint("http://localhost:4566")).toBe(false);
    expect(isAwsHostedEndpoint("http://floci:4566")).toBe(false);
    expect(isAwsHostedEndpoint("http://localhost:4566/amazonaws.com")).toBe(false);
    expect(isAwsHostedEndpoint("https://amazonaws.com.evil.example")).toBe(false);
    expect(isAwsHostedEndpoint("https://evilamazonaws.com")).toBe(false);
    expect(isAwsHostedEndpoint("not a url")).toBe(false);
  });
});

describe("THEME_BOOT_SCRIPT", () => {
  it("is plain script text with no literal closing tag", () => {
    expect(THEME_BOOT_SCRIPT).not.toContain("</");
    expect(THEME_BOOT_SCRIPT.startsWith("(function(){")).toBe(true);
  });
});

describe("redactArgs", () => {
  it("hides the value after a secret-looking flag", () => {
    expect(redactArgs(["ssm", "put-parameter", "--value", "hunter2", "--name", "x"])).toEqual([
      "ssm", "put-parameter", "--value", "***", "--name", "x",
    ]);
  });

  it("hides secret-looking name=value pairs but keeps ordinary ones", () => {
    expect(redactArgs(["-var", "groq_api_key=gsk_abc", "-var", "region=us-east-1"])).toEqual([
      "-var", "groq_api_key=***", "-var", "region=us-east-1",
    ]);
  });

  it("leaves a file:// reference alone", () => {
    expect(redactArgs(["--name", "p", "--region", "us-east-1"])).toEqual(["--name", "p", "--region", "us-east-1"]);
  });
});
