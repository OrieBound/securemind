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

/** AWS CLI --output text can print "None" plus a pagination token as extra lines. */
export function normalizeAmplifyJobId(raw) {
  const first = String(raw || "")
    .split(/\s+/)
    .map(s => s.trim())
    .find(s => /^\d+$/.test(s));
  return first || "";
}

function inflightJobId(appId, branch) {
  const out = awsJson(["amplify", "list-jobs", "--app-id", appId, "--branch-name", branch]);
  const rows = Array.isArray(out?.jobSummaries) ? out.jobSummaries : [];
  const hit = rows.find(j => j.status === "RUNNING" || j.status === "PENDING");
  return normalizeAmplifyJobId(hit?.jobId);
}

async function main() {
  const appId = arg("--app-id") || process.env.AMPLIFY_APP_ID;
  const branch = arg("--branch") || process.env.AMPLIFY_BRANCH || "main";
  let jobId = normalizeAmplifyJobId(arg("--job-id") || process.env.AMPLIFY_JOB_ID);
  if (!appId) fail("need --app-id");
  if (!jobId) jobId = inflightJobId(appId, branch);
  if (!jobId) fail("need a numeric Amplify --job-id (got a None/pagination stub from aws cli)");

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
      jobId,
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

if (String(process.argv[1] || "").replace(/\\/g, "/").endsWith("amplify-wait-job.mjs")) {
  void main();
}
