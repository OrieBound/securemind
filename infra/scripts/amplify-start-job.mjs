#!/usr/bin/env node
/**
 * Trigger an Amplify build for the connected branch (GitHub Actions / operator).
 * Amplify clones GitHub and builds — this does not upload a zip.
 */

import {
  aws,
  commonArgsFromEnv,
  fail,
  loadDeployEnv,
  resolveDeployEnvPath,
  stackOutputs,
} from "./lib.mjs";

function main() {
  loadDeployEnv(resolveDeployEnvPath());
  const args = commonArgsFromEnv();
  const amplifyOut = stackOutputs("amplify", args);
  const appId = amplifyOut.AmplifyAppId;
  const branch = process.env.AMPLIFY_BRANCH || "main";
  if (!appId) fail("amplify_app_id missing — terraform apply first.");

  aws([
    "amplify",
    "start-job",
    "--app-id",
    appId,
    "--branch-name",
    branch,
    "--job-type",
    "RELEASE",
  ]);
}

main();
