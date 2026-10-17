import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const tf = readFileSync(join(process.cwd(), "infra/terraform/modules/api/main.tf"), "utf8");

describe("API Gateway error responses", () => {
  it("add the security headers to every error API Gateway generates itself", () => {
    for (const type of ["DEFAULT_4XX", "DEFAULT_5XX"]) {
      expect(tf).toMatch(new RegExp(`response_type\\s*=\\s*"${type}"`));
    }
    expect(tf).toContain("gatewayresponse.header.X-Content-Type-Options");
    expect(tf).toContain("gatewayresponse.header.Strict-Transport-Security");
    expect(tf).toContain("gatewayresponse.header.Referrer-Policy");
  });

  it("redeploys the stage when those responses change", () => {
    expect(tf).toMatch(/aws_api_gateway_gateway_response\.default_4xx\.id/);
    expect(tf).toMatch(/aws_api_gateway_gateway_response\.default_5xx\.id/);
  });
});
