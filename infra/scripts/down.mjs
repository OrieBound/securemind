#!/usr/bin/env node
/**
 * One-button teardown. Loads .env.deploy for profile/region/env name.
 * Requires confirmation: npm run infra:down -- --yes
 */

import path from "node:path";
import {
  ROOT,
  commonArgsFromEnv,
  fail,
  loadDeployEnv,
  resolveDeployEnvPath,
  run,
} from "./lib.mjs";

function main() {
  loadDeployEnv(resolveDeployEnvPath());
  const args = commonArgsFromEnv();
  const yes = process.argv.includes("--yes") || process.argv.includes("-y");
  if (!yes) fail("Refusing to tear down without --yes");

  const cli = [
    path.join(ROOT, "infra/scripts/teardown.mjs"),
    "--stack",
    "all",
    "--env-name",
    args.envName,
    "--region",
    args.region,
    "--yes",
  ];
  if (args.profile) cli.push("--profile", args.profile);
  run("node", cli);
}

main();
