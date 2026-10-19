#!/usr/bin/env node
/**
 * Deploy SecureMind cloud stack via Terraform (replaces CloudFormation/SAM).
 */

import { existsSync } from "node:fs";
import path from "node:path";
import {
  ROOT,
  TF_BACKEND_HCL,
  commonArgsFromEnv,
  fail,
  loadDeployEnv,
  resolveDeployEnvPath,
  run,
  terraform,
} from "./lib.mjs";

function main() {
  loadDeployEnv(resolveDeployEnvPath());
  const args = commonArgsFromEnv();
  console.log(JSON.stringify({ ...args, tool: "terraform" }, null, 2));

  run("node", [path.join(ROOT, "infra/scripts/package-lambda.mjs")]);

  if (!existsSync(TF_BACKEND_HCL)) {
    fail(`Missing ${path.relative(ROOT, TF_BACKEND_HCL)}. Bootstrap first (infra/terraform/bootstrap).`);
  }

  terraform(["init", "-backend-config=backend.hcl", "-input=false"]);
  terraform(["apply", "-auto-approve", "-input=false"]);
}

main();
