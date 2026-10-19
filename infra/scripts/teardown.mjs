#!/usr/bin/env node
/**
 * Tear down the Terraform workspace. Requires --yes.
 * DynamoDB fragments table is Retain in CloudFormation nested stack — may remain.
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
  terraform,
} from "./lib.mjs";

function parseArgs(argv) {
  const out = { yes: false };
  for (const a of argv) {
    if (a === "--yes" || a === "-y") out.yes = true;
  }
  return out;
}

function main() {
  loadDeployEnv(resolveDeployEnvPath());
  const args = parseArgs(process.argv.slice(2));
  if (!args.yes) fail("Refusing to tear down without --yes.");
  console.log(JSON.stringify({ ...commonArgsFromEnv(), tool: "terraform destroy" }, null, 2));

  if (!existsSync(TF_BACKEND_HCL)) {
    fail(`Missing ${path.relative(ROOT, TF_BACKEND_HCL)}.`);
  }

  terraform(["init", "-backend-config=backend.hcl", "-input=false"]);
  terraform(["destroy", "-auto-approve", "-input=false"]);
  console.log("\nTeardown finished (check Retain DynamoDB/Secrets leftovers in the console).");
}

main();
