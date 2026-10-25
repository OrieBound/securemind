import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const bootstrap = read("infra/terraform/bootstrap/main.tf");
const ci = read(".github/workflows/ci.yml");
const amplify = read("infra/terraform/modules/amplify/main.tf");

const planJob = ci.slice(ci.indexOf("  terraform-plan:"), ci.indexOf("  # Optional. Off unless the repository variable AWS_DEPLOY_ENABLED"));

describe("pull-request plan role", () => {
  it("is a separate role with AWS ReadOnlyAccess and the same environment-scoped trust", () => {
    const role = bootstrap.match(/resource "aws_iam_role" "gha_plan" \{[\s\S]*?\n\}/)![0];
    expect(role).toContain("data.aws_iam_policy_document.gha_trust.json");
    expect(bootstrap).toMatch(/gha_plan_readonly[\s\S]*?arn:aws:iam::aws:policy\/ReadOnlyAccess/);
  });

  it("cannot read people's data or other projects' objects and parameters", () => {
    const doc = bootstrap.match(/data "aws_iam_policy_document" "gha_plan" \{[\s\S]*?\r?\n\}\r?\n/)![0];
    for (const action of ["dynamodb:GetItem", "dynamodb:Scan", "logs:GetLogEvents", "secretsmanager:GetSecretValue", "cognito-idp:ListUsers"]) {
      expect(doc, action).toContain(`"${action}"`);
    }
    expect(doc).toMatch(/NoObjectReadsOutsideState[\s\S]*?effect\s*=\s*"Deny"[\s\S]*?not_resources\s*=\s*\["\$\{aws_s3_bucket\.state\.arn\}\/\*"\]/);
    expect(doc).toMatch(/NoParameterReadsOutsideProject[\s\S]*?parameter\/securemind\/\*/);
    // KMS decrypt only through SSM, only for this project's parameters.
    expect(doc).toMatch(/kms:ViaService[\s\S]*?kms:EncryptionContext:PARAMETER_ARN/);
    // No write actions at all.
    expect(doc).not.toMatch(/"(iam|s3|lambda|apigateway|amplify|dynamodb):(Put|Create|Update|Delete)/);
  });

  it("is what the CI plan job assumes, never the deploy role, and the plan does not take the lock", () => {
    expect(planJob).toContain("vars.AWS_PLAN_ROLE_ARN");
    expect(planJob).not.toMatch(/vars\.AWS_ROLE_ARN\b/);
    expect(planJob).toContain("terraform plan -input=false -no-color -lock=false");
  });
});

describe("Amplify server logs and build spec", () => {
  it("keeps the server logs for a limited time", () => {
    expect(amplify).toMatch(/resource "aws_cloudwatch_log_group" "ssr"[\s\S]*?retention_in_days\s*=\s*var\.ssr_log_retention_days/);
    expect(amplify).toMatch(/variable "ssr_log_retention_days"[\s\S]*?default\s*=\s*30/);
  });

  it("has no Secrets Manager permissions left in the bootstrap policies", () => {
    expect(bootstrap).not.toContain("secretsmanager:*");
    expect(bootstrap).not.toMatch(/OlderSecrets|AppSecretsOlderInstalls/);
    // The only mention left is the plan role's explicit deny.
    expect(bootstrap.match(/"secretsmanager:[A-Za-z]+"/g)).toEqual(['"secretsmanager:GetSecretValue"']);
  });
});
