#!/usr/bin/env node
/**
 * Poll one Amplify Hosting job until SUCCEED / FAILED / CANCELLED.
 * Used by GitHub Actions so a red Amplify build fails the CI check
 * (StartJob alone always returns immediately).
 *
 *   node infra/scripts/amplify-wait-job.mjs --app-id dxxx --branch main --job-id 6
 */

import { setTimeout as sleep } from "node:timers/promises";
import { awsJson, fail } from "./lib.mjs";

function arg(flag) {
  const i = process.argv.indexOf(flag);
  if (i < 0 || !process.argv[i + 1]) return "";
  return process.argv[i + 1];
}

async function main() {
  const appId = arg("--app-id") || process.env.AMPLIFY_APP_ID;
  const branch = arg("--branch") || process.env.AMPLIFY_BRANCH || "main";
  const jobId = arg("--job-id") || process.env.AMPLIFY_JOB_ID;
  if (!appId || !jobId) fail("need --app-id and --job-id");

  const deadline = Date.now() + 25 * 60 * 1000;
  while (Date.now() < deadline) {
    const out = awsJson([
      "amplify",
      "get-job",
      "--app-id",
      appId,
      "--branch-name",
      branch,
      "--job-id",
      String(jobId),
    ]);
    const status = out?.job?.summary?.status || "UNKNOWN";
    console.log(`Amplify job ${jobId}: ${status}`);
    if (status === "SUCCEED") process.exit(0);
    if (status === "FAILED" || status === "CANCELLED") {
      fail(`Amplify job ${jobId} ${status} (console Hosting → Deployments)`);
    }
    await sleep(15_000);
  }
  fail(`timed out waiting for Amplify job ${jobId}`);
}

main();
