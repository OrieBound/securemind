/**
 * The custom-domain Terraform is staged and off by default. These checks guard that: nothing
 * in the domain module may exist until a domain is set, nothing that needs working DNS may
 * exist until stage 2, and the running app and API must not depend on the module (no cycle).
 * They read the .tf text; `terraform validate` covers syntax and references.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chooseSiteUrl } from "../infra/scripts/lib.mjs";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const domain = read("infra/terraform/modules/domain/main.tf");
const root = read("infra/terraform/main.tf");

/** Every `resource "type" "name" { ... }` body in a .tf file, by simple brace matching. */
function resources(tf: string): Array<{ type: string; name: string; body: string }> {
  const out: Array<{ type: string; name: string; body: string }> = [];
  const re = /resource\s+"([^"]+)"\s+"([^"]+)"\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tf))) {
    let depth = 1;
    let i = re.lastIndex;
    while (i < tf.length && depth > 0) {
      if (tf[i] === "{") depth++;
      else if (tf[i] === "}") depth--;
      i++;
    }
    out.push({ type: m[1], name: m[2], body: tf.slice(re.lastIndex, i - 1) });
  }
  return out;
}

describe("domain module is off until configured", () => {
  const list = resources(domain);

  it("has the resources we expect", () => {
    const types = list.map(r => r.type);
    expect(types).toEqual(
      expect.arrayContaining([
        "aws_route53_zone",
        "aws_amplify_domain_association",
        "aws_acm_certificate",
        "aws_api_gateway_domain_name",
        "aws_api_gateway_base_path_mapping",
        "aws_route53_record",
      ]),
    );
  });

  it("gates every resource behind a count or for_each", () => {
    for (const r of list) {
      expect(/\bcount\s*=|\bfor_each\s*=/.test(r.body), `${r.type}.${r.name}`).toBe(true);
    }
  });

  it("defaults to no domain and no stage 2", () => {
    expect(domain).toMatch(/variable "domain_name"[\s\S]*?default\s*=\s*""/);
    expect(domain).toMatch(/variable "enable_custom_domains"[\s\S]*?default\s*=\s*false/);
    expect(domain).toMatch(/variable "api_subdomain"[\s\S]*?default\s*=\s*""/);
  });

  it("creates only the zone in stage 1, and the Amplify, certificate and API parts in stage 2", () => {
    const gate = (type: string, name: string) => list.find(r => r.type === type && r.name === name)!.body;
    expect(gate("aws_route53_zone", "this")).toMatch(/count\s*=\s*local\.zone_enabled/);
    expect(gate("aws_amplify_domain_association", "app")).toMatch(/count\s*=\s*local\.custom\b/);
    expect(gate("aws_acm_certificate", "api")).toMatch(/count\s*=\s*local\.api_custom/);
    expect(gate("aws_api_gateway_domain_name", "api")).toMatch(/count\s*=\s*local\.api_custom/);
    expect(domain).toMatch(/custom\s*=\s*local\.zone_enabled && var\.enable_custom_domains/);
    expect(domain).toMatch(/api_custom\s*=\s*local\.custom && var\.api_subdomain != ""/);
  });

  it("tolerates records Amplify may already have added", () => {
    for (const r of list.filter(x => x.type === "aws_route53_record")) {
      expect(r.body, r.name).toMatch(/allow_overwrite\s*=\s*true|zone_id\s*=/);
    }
    expect(domain.match(/allow_overwrite\s*=\s*true/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it("lets two record types share one name through a key suffix", () => {
    expect(domain).toMatch(/split\("\/", each\.key\)\[0\]/);
    expect(read("docs/deploy/custom-domain.md")).toContain('"@/MX"');
  });

  it("uses a regional API domain, matching the REST API", () => {
    expect(domain).toMatch(/endpoint_configuration[\s\S]*?types\s*=\s*\["REGIONAL"\]/);
    expect(read("infra/terraform/modules/api/main.tf")).toMatch(/types\s*=\s*\["REGIONAL"\]/);
  });

  it("requires TLS 1.2 on the API domain", () => {
    expect(domain).toMatch(/security_policy\s*=\s*"TLS_1_2"/);
  });
});

describe("root wiring", () => {
  it("falls back to today's addresses when no domain is set", () => {
    expect(root).toMatch(/api_public_url\s*=\s*local\.custom_domains && var\.api_subdomain != "" \? "https:\/\/\$\{var\.api_subdomain\}\.\$\{var\.domain_name\}" : module\.api\.api_base_url/);
    expect(root).toMatch(/allowed_origin\s*=\s*local\.app_url != "" \? local\.app_url : var\.allowed_origin/);
    expect(root).toMatch(/custom_domains\s*=\s*var\.domain_name != "" && var\.enable_custom_domains/);
  });

  it("keeps localhost sign-in URLs and adds the app URL and allowed origin only when they exist", () => {
    expect(root).toContain('"http://localhost:3000/login"');
    expect(root).toMatch(/login_origins\s*=\s*distinct\(compact\(\[local\.app_url,/);
    expect(root).toMatch(/\$\{o\}\/login/);
  });

  it("gives the app and API the new addresses through plain variables, not the module", () => {
    expect(root).toMatch(/api_base_url\s*=\s*local\.api_public_url/);
    const appAndApi = root.slice(root.indexOf('module "api"'), root.indexOf('module "domain"'));
    expect(appAndApi).not.toContain("module.domain");
  });

  it("exposes what the operator needs for each stage", () => {
    for (const name of ["route53_name_servers", "app_url", "api_public_url", "api_base_url"]) {
      expect(root, name).toContain(`output "${name}"`);
    }
  });

  it("passes the module only what it needs", () => {
    const block = root.slice(root.indexOf('module "domain"'), root.indexOf('output "api_base_url"'));
    expect(block).toContain("module.amplify.app_id");
    expect(block).toContain("module.api.rest_api_id");
  });
});

describe("chooseSiteUrl", () => {
  it("prefers an explicit override, then the custom domain, then Amplify's address", () => {
    expect(chooseSiteUrl({ envUrl: "https://a.example", customUrl: "https://b.example", amplifyUrl: "https://c.example" })).toBe("https://a.example");
    expect(chooseSiteUrl({ envUrl: "", customUrl: "https://b.example", amplifyUrl: "https://c.example" })).toBe("https://b.example");
    expect(chooseSiteUrl({ customUrl: undefined, amplifyUrl: "https://c.example" })).toBe("https://c.example");
  });

  it("removes a trailing slash and ignores blanks", () => {
    expect(chooseSiteUrl({ envUrl: "  https://a.example/ " })).toBe("https://a.example");
    expect(chooseSiteUrl({ envUrl: "  ", customUrl: "", amplifyUrl: "" })).toBeNull();
    expect(chooseSiteUrl()).toBeNull();
  });
});
