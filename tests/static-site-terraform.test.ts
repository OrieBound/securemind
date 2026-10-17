/**
 * The static-site module hosts a marketing page and a demo. These checks guard what makes it safe to
 * publish: it is off unless configured, the bucket is private, HTTPS is enforced, the deploy role is
 * pinned to one repository branch, and no real domain or repository ID lives in tracked files.
 * They read the .tf text; `terraform validate` covers syntax and references.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const mod = read("infra/terraform/modules/static_site/main.tf");
const root = read("infra/terraform/main.tf");
const example = read("infra/terraform/domain.tfvars.example");

describe("static site module", () => {
  it("keeps the bucket private and only readable through CloudFront", () => {
    expect(mod).toMatch(/block_public_acls\s*=\s*true/);
    expect(mod).toMatch(/restrict_public_buckets\s*=\s*true/);
    expect(mod).toMatch(/identifiers\s*=\s*\["cloudfront\.amazonaws\.com"\]/);
    expect(mod).toMatch(/AWS:SourceArn/);
    expect(mod).toMatch(/aws:SecureTransport/);
  });

  it("forces HTTPS and a modern TLS floor", () => {
    expect(mod).toMatch(/viewer_protocol_policy\s*=\s*"redirect-to-https"/);
    expect(mod).toMatch(/minimum_protocol_version\s*=\s*"TLSv1\.2_2021"/);
    expect(mod).toMatch(/ssl_support_method\s*=\s*"sni-only"/);
  });

  it("gets its certificate from us-east-1 and validates it through DNS", () => {
    expect(mod).toMatch(/provider\s*=\s*aws\.cloudfront_cert/);
    expect(mod).toMatch(/validation_method\s*=\s*"DNS"/);
    expect(root).toMatch(/alias\s*=\s*"cloudfront_cert"\s*\n\s*region\s*=\s*"us-east-1"/);
  });

  it("pins the deploy role to one repository and branch, with no wildcard", () => {
    expect(mod).toMatch(/token\.actions\.githubusercontent\.com:sub/);
    expect(mod).toMatch(/\$\{var\.github_subject_prefix\}:ref:refs\/heads\/\$\{var\.github_branch\}/);
    expect(mod).not.toMatch(/StringLike/);
  });

  it("limits the deploy role to its own bucket and distribution", () => {
    expect(mod).toMatch(/resources\s*=\s*\[aws_s3_bucket\.site\.arn\]/);
    expect(mod).toMatch(/resources\s*=\s*\[aws_cloudfront_distribution\.site\.arn\]/);
  });
});

describe("root wiring", () => {
  it("builds nothing unless static_sites is set", () => {
    expect(root).toMatch(/variable "static_sites"[\s\S]*?default\s*=\s*\{\}/);
    expect(root).toMatch(/module "static_site"\s*\{\s*\n\s*for_each\s*=\s*var\.static_sites/);
  });

  it("documents the option with placeholder values only", () => {
    expect(example).toContain("static_sites");
    expect(example).toContain("example.com");
  });
});

describe("no private values in tracked Terraform", () => {
  it("names no real domain or repository ID", () => {
    for (const text of [mod, root, example]) {
      expect(text).not.toMatch(/securemind\.chat/);
      expect(text).not.toMatch(/@246911754/);
    }
  });
});
