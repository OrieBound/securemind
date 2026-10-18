import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const api = readFileSync(join(process.cwd(), "infra/terraform/modules/api/main.tf"), "utf8").replace(/\r\n/g, "\n");

describe("the open API gateway is rate limited", () => {
  it("sets a throttle on every method of the stage", () => {
    expect(api).toMatch(/resource "aws_api_gateway_method_settings" "all"[\s\S]*?method_path\s*=\s*"\*\/\*"/);
    expect(api).toMatch(/throttling_rate_limit\s*=\s*var\.throttle_rate_limit/);
    expect(api).toMatch(/throttling_burst_limit\s*=\s*var\.throttle_burst_limit/);
  });

  it("defaults to a low limit, so a flood cannot run up a large bill", () => {
    const rate = Number(/variable "throttle_rate_limit"[\s\S]*?default\s*=\s*(\d+)/.exec(api)?.[1]);
    const burst = Number(/variable "throttle_burst_limit"[\s\S]*?default\s*=\s*(\d+)/.exec(api)?.[1]);
    expect(rate).toBeGreaterThan(0);
    expect(rate).toBeLessThanOrEqual(50);
    expect(burst).toBeGreaterThanOrEqual(rate);
    expect(burst).toBeLessThanOrEqual(100);
  });

  it("ties the setting to the stage it protects", () => {
    expect(api).toMatch(/stage_name\s*=\s*aws_api_gateway_stage\.prod\.stage_name/);
  });
});
