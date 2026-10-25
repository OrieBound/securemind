import { describe, expect, it } from "vitest";
import { roleSessionName, transcribeStreamConfig } from "./stream-session";

const ROLE = "arn:aws:iam::123456789012:role/securemind-transcribe-stream-prod";

describe("transcribeStreamConfig", () => {
  it("needs both a role and a region", () => {
    expect(transcribeStreamConfig({ TRANSCRIBE_STREAM_ROLE_ARN: ROLE, TRANSCRIBE_STREAM_REGION: "us-east-1" })).toEqual({
      roleArn: ROLE,
      region: "us-east-1",
    });
    expect(transcribeStreamConfig({ TRANSCRIBE_STREAM_ROLE_ARN: ROLE })).toBeNull();
    expect(transcribeStreamConfig({ TRANSCRIBE_STREAM_REGION: "us-east-1" })).toBeNull();
    expect(transcribeStreamConfig({})).toBeNull();
  });

  it("rejects a malformed role or region rather than signing for it", () => {
    expect(transcribeStreamConfig({ TRANSCRIBE_STREAM_ROLE_ARN: "not-an-arn", TRANSCRIBE_STREAM_REGION: "us-east-1" })).toBeNull();
    expect(
      transcribeStreamConfig({ TRANSCRIBE_STREAM_ROLE_ARN: "arn:aws:s3:::bucket", TRANSCRIBE_STREAM_REGION: "us-east-1" }),
    ).toBeNull();
    expect(
      transcribeStreamConfig({ TRANSCRIBE_STREAM_ROLE_ARN: ROLE, TRANSCRIBE_STREAM_REGION: "us-east-1.evil.example" }),
    ).toBeNull();
  });
});

describe("roleSessionName", () => {
  it("is stable per user, valid for STS, and does not contain the id", () => {
    const a = roleSessionName("someone@example.com");
    expect(a).toBe(roleSessionName("someone@example.com"));
    expect(a).not.toBe(roleSessionName("other@example.com"));
    expect(a).toMatch(/^[\w+=,.@-]{2,64}$/);
    expect(a).not.toContain("someone");
  });
});
