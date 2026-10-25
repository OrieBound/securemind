import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const amplify = read("infra/terraform/modules/amplify/main.tf");
const bootstrap = read("infra/terraform/bootstrap/main.tf");
const rootMain = read("infra/terraform/main.tf");

describe("direct live captions: the signing role", () => {
  it("is a separate role that can only open a Transcribe stream", () => {
    const policy = amplify.match(/data "aws_iam_policy_document" "transcribe_stream" \{[\s\S]*?\n\}/)![0];
    const actions = [...policy.matchAll(/"([a-z0-9-]+:[A-Za-z*]+)"/g)].map(m => m[1]);
    expect(actions).toEqual(["transcribe:StartStreamTranscriptionWebSocket"]);
  });

  it("trusts only the compute role, and carries the permissions boundary", () => {
    const trust = amplify.match(/data "aws_iam_policy_document" "transcribe_stream_trust" \{[\s\S]*?\n\}/)![0];
    expect(trust).toContain("aws_iam_role.compute.arn");
    expect(trust).not.toMatch(/"\*"/);
    const role = amplify.match(/resource "aws_iam_role" "transcribe_stream" \{[\s\S]*?\n\}/)![0];
    expect(role).toContain("permissions_boundary");
  });

  it("lets the compute role assume that one role and nothing wider", () => {
    const doc = amplify.match(/data "aws_iam_policy_document" "amplify_assume_transcribe_stream" \{[\s\S]*?\n\}/)![0];
    expect(doc).toContain("aws_iam_role.transcribe_stream[0].arn");
    expect(doc).not.toMatch(/resources\s*=\s*\["\*"\]/);
  });

  it("is switched on only by a region, and hands the app both settings", () => {
    expect(amplify).toMatch(/direct_captions\s*=\s*var\.transcribe_stream_region != ""/);
    expect(amplify).toMatch(/TRANSCRIBE_STREAM_ROLE_ARN\s*=\s*aws_iam_role\.transcribe_stream\[0\]\.arn/);
    expect(amplify).toMatch(/TRANSCRIBE_STREAM_REGION\s*=\s*var\.transcribe_stream_region/);
    expect(rootMain).toMatch(/transcribe_stream_region\s*=\s*var\.aws_region/);
  });

  it("bakes both settings into the build so the page's connection policy sees them", () => {
    const keys = JSON.parse(read("infra/scripts/amplify-production-env-keys.json")) as string[];
    expect(keys).toContain("TRANSCRIBE_STREAM_ROLE_ARN");
    expect(keys).toContain("TRANSCRIBE_STREAM_REGION");
  });

  it("is allowed by the deploy role's boundary, for this one role pattern only", () => {
    const stmt = bootstrap.match(/sid\s*=\s*"AssumeTranscribeStreamRole"[\s\S]*?\n  \}/)![0];
    expect(stmt).toContain("sts:AssumeRole");
    expect(stmt).toContain("role/securemind-transcribe-stream-*");
    expect(bootstrap).toContain("transcribe:StartStreamTranscriptionWebSocket");
  });
});
