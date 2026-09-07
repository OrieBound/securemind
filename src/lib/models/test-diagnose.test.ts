import { describe, expect, it } from "vitest";
import { diagnoseModelTestError } from "./test-diagnose";

describe("diagnoseModelTestError", () => {
  it("does not blame the Amplify role when AWS says the account cannot use the model", () => {
    const err = Object.assign(
      new Error(
        "anthropic.claude-sonnet-5 is not available for this account. You can explore other available models on Amazon Bedrock. For additional access options, contact AWS Sales at https://aws.amazon.com/contact-us/sales-support/",
      ),
      { name: "AccessDeniedException" },
    );
    const d = diagnoseModelTestError(err, "bedrock", "us.anthropic.claude-sonnet-5");
    expect(d.code).toBe("not_entitled");
    expect(d.remediation).toMatch(/Model catalog/i);
    expect(d.remediation).not.toMatch(/Marketplace model deployments/i);
    expect(d.remediation).toMatch(/same role|IAM role problem/i);
  });

  it("keeps IAM copy for a genuine access-denied invoke", () => {
    const err = Object.assign(
      new Error("User is not authorized to perform: bedrock:InvokeModel"),
      { name: "AccessDeniedException" },
    );
    const d = diagnoseModelTestError(err, "bedrock", "amazon.nova-micro-v1:0");
    expect(d.code).toBe("access_denied");
    expect(d.remediation).toMatch(/Amplify UI role/i);
  });

  it("classifies speech models as not chat", () => {
    const err = new Error(
      "This action doesn't support the model that you provided. Try again with a supported text or chat model.",
    );
    const d = diagnoseModelTestError(err, "bedrock", "amazon.nova-2-sonic-v1:0");
    expect(d.code).toBe("not_chat_model");
    expect(d.remediation).toMatch(/speech|audio|text chat/i);
  });
});
