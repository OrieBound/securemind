import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("monitoring and recovery settings", () => {
  const mon = read("infra/terraform/modules/monitoring/main.tf");
  const table = read("infra/terraform/modules/data_dynamodb/fragments.cfn.yaml");
  const root = read("infra/terraform/main.tf");
  const api = read("infra/terraform/modules/api/main.tf");

  it("turns on point-in-time recovery and deletion protection for the data table", () => {
    expect(table).toMatch(/PointInTimeRecoveryEnabled:\s*true/);
    expect(table).toMatch(/DeletionProtectionEnabled:\s*true/);
  });

  it("makes Cognito deletion protection configurable from the root", () => {
    expect(root).toMatch(/variable "cognito_deletion_protection"/);
    expect(root).toMatch(/deletion_protection\s*=\s*var\.cognito_deletion_protection/);
  });

  it("validates CloudTrail log files and keeps the bucket private and TLS-only", () => {
    expect(mon).toMatch(/enable_log_file_validation\s*=\s*true/);
    expect(mon).toMatch(/restrict_public_buckets\s*=\s*true/);
    expect(mon).toMatch(/aws:SecureTransport/);
  });

  it("alarms on Lambda errors, API 5xx and 4xx spikes", () => {
    for (const name of ["chat_errors", "chat_throttles", "api_5xx", "api_4xx_spike"]) {
      expect(mon).toContain(`resource "aws_cloudwatch_metric_alarm" "${name}"`);
    }
  });

  it("wires the monitoring module and optional access logs", () => {
    expect(root).toMatch(/module "monitoring"/);
    expect(api).toMatch(/access_log_settings/);
  });
});
