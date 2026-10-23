#!/usr/bin/env node
/**
 * Update only the chat and warm Lambdas (the `api` module) from the current code.
 *
 *   node infra/scripts/update-chat-lambda.mjs           plan only: shows what would change
 *   node infra/scripts/update-chat-lambda.mjs --apply   same plan, then Terraform asks you to type "yes"
 *
 * Why this exists: the chat code runs inside the Lambda package, so a new Amplify build does not
 * update it. A full `infra:deploy` also applies everything else in the stack. This script goes
 * through the same settings loader as the other infra scripts (so env_name, keys and origins are
 * passed correctly), refuses to run if the signed-in AWS account is not the account that owns the
 * Terraform state, and never auto-approves.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import {
  ROOT,
  TF_BACKEND_HCL,
  assertAwsIdentity,
  commonArgsFromEnv,
  fail,
  loadDeployEnv,
  resolveDeployEnvPath,
  run,
  terraform,
} from "./lib.mjs";

function main() {
  const apply = process.argv.includes("--apply");

  loadDeployEnv(resolveDeployEnvPath());
  const { envName, region, profile } = commonArgsFromEnv();

  // 1. The environment name must match the Terraform state this folder points at.
  const backend = readFileSync(TF_BACKEND_HCL, "utf8");
  const stateKey = /key\s*=\s*"([^"]+)"/.exec(backend)?.[1] ?? "";
  const bucket = /bucket\s*=\s*"([^"]+)"/.exec(backend)?.[1] ?? "";
  if (stateKey !== `securemind/${envName}/terraform.tfstate`) {
    fail(`ENV_NAME is "${envName}" but backend.hcl points at "${stateKey}". Refusing to continue.`);
  }

  // 2. The signed-in account must be the account that owns that state bucket.
  const id = assertAwsIdentity();
  const bucketAccount = /securemind-tfstate-(\d{12})-/.exec(bucket)?.[1];
  if (bucketAccount && id.Account !== bucketAccount) {
    fail("The signed-in AWS account is not the account that owns the Terraform state bucket. Refusing to continue.");
  }
  console.log(`Environment: ${envName}  Region: ${region}  Profile: ${profile || "(default)"}`);
  console.log("Account matches the Terraform state bucket. Scope: module.api only.\n");

  run("node", [path.join(ROOT, "infra/scripts/package-lambda.mjs")]);
  terraform(["init", "-backend-config=backend.hcl", "-input=false"]);

  if (!apply) {
    terraform(["plan", "-target=module.api", "-input=false"]);
    console.log("\nPlan only. To apply, run this script again with --apply and type yes when asked.");
    return;
  }
  // No -auto-approve: Terraform shows the plan and waits for you to type "yes".
  terraform(["apply", "-target=module.api"], { stdio: "inherit" });
}

main();
