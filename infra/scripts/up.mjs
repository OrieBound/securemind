#!/usr/bin/env node
/**
 * One-button SecureMind cloud bring-up (Terraform).
 *
 *   1. aws sso login --profile <profile>
 *   2. Copy infra/env.deploy.example → .env.deploy
 *   3. Bootstrap once: infra/terraform/bootstrap (S3 state + GitHub OIDC role)
 *   4. npm run infra:up
 *
 * Does not apply until you run it. Default data plane is DynamoDB (no Neon/Aurora).
 */

import { existsSync } from "node:fs";
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

function parseArgs(argv) {
  const out = { skipWire: false, skipBedrock: false };
  for (const a of argv) {
    if (a === "--skip-wire") out.skipWire = true;
    else if (a === "--skip-bedrock") out.skipBedrock = true;
    else if (a === "--help" || a === "-h") {
      console.log(`Usage: npm run infra:up
  Loads .env.deploy then terraform apply + wire.
  Flags: --skip-wire`);
      process.exit(0);
    }
  }
  return out;
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  const envPath = resolveDeployEnvPath();

  if (!existsSync(envPath)) {
    fail(
      `Missing ${path.relative(ROOT, envPath)}. Copy infra/env.deploy.example → .env.deploy and fill AWS_PROFILE.`,
    );
  }

  loadDeployEnv(envPath);
  const args = commonArgsFromEnv();

  console.log(`
SecureMind infra:up (Terraform)
  env file : ${path.relative(ROOT, envPath)}
  env name : ${args.envName}
  region   : ${args.region}
  profile  : ${args.profile || "(default chain)"}
`);

  assertAwsIdentity(args);

  run("node", [path.join(ROOT, "infra/scripts/package-lambda.mjs")]);

  if (!existsSync(TF_BACKEND_HCL)) {
    fail(
      `Missing ${path.relative(ROOT, TF_BACKEND_HCL)}. Run the bootstrap in infra/terraform/bootstrap first, then copy backend_hcl output to that file.`,
    );
  }

  terraform(["init", "-reconfigure", "-upgrade", "-backend-config=backend.hcl", "-input=false"]);
  terraform(["apply", "-auto-approve", "-input=false"]);

  if (!flags.skipWire) {
    run("node", [path.join(ROOT, "infra/scripts/wire.mjs")]);
  }

  console.log(`
────────────────────────────────────────
  Terraform apply finished (sandbox/cloud).
  Next: connect the GitHub repo in the Amplify console (GitHub App),
  then GitHub Actions will StartJob after a green deploy.
  Re-run: npm run infra:wire  after the first Amplify URL exists.
────────────────────────────────────────
`);
}

main();
