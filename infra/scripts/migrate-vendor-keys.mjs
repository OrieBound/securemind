#!/usr/bin/env node
/**
 * One-time move of Admin-pasted vendor keys from the old Secrets Manager secret
 * (securemind/<env>/vendor-keys) into the Parameter Store parameter
 * (/securemind/<env>/vendor-keys) that the app now reads and writes.
 *
 * Run it after `terraform apply` has created the parameter and before you delete anything by
 * hand. Terraform removes the old secret with a 7-day recovery window, so this script can
 * still read it afterwards: it restores the secret, copies the keys, then schedules the
 * deletion again.
 *
 * It never prints a key. It reports only how many it moved. Skip it if you never pasted a key
 * in the app. Usage: npm run infra:migrate-vendor-keys [-- --force]
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  assertAwsIdentity,
  aws,
  awsJson,
  commonArgsFromEnv,
  fail,
  loadDeployEnv,
  resolveDeployEnvPath,
} from "./lib.mjs";

const FORCE = process.argv.includes("--force");

/** Count the stored keys without exposing them. */
function countKeys(raw) {
  try {
    const bundle = JSON.parse(raw);
    return (bundle.groqApiKey ? 1 : 0) + (Array.isArray(bundle.extra) ? bundle.extra.length : 0);
  } catch {
    return raw && raw.trim() ? 1 : 0;
  }
}

function readOldSecret(args, secretId) {
  const read = () => awsJson(["secretsmanager", "get-secret-value", "--secret-id", secretId], args);
  let out = read();
  let restored = false;
  if (!out) {
    // Terraform deletes the secret with a recovery window. Bring it back to read it.
    const back = aws(["secretsmanager", "restore-secret", "--secret-id", secretId], { ...args, check: false, stdio: "pipe", encoding: "utf8" });
    if (back.status === 0) {
      restored = true;
      out = read();
    }
  }
  return { raw: out?.SecretString ?? null, restored };
}

function main() {
  loadDeployEnv(resolveDeployEnvPath());
  const args = commonArgsFromEnv();
  assertAwsIdentity(args);

  const oldId = `securemind/${args.envName}/vendor-keys`;
  const paramName = `/securemind/${args.envName}/vendor-keys`;

  const target = awsJson(["ssm", "get-parameter", "--name", paramName, "--with-decryption"], args);
  if (!target) fail(`Parameter ${paramName} not found. Run terraform apply first (npm run infra:up).`);
  const existing = countKeys(target.Parameter?.Value ?? "");
  if (existing > 0 && !FORCE) {
    console.log(`The parameter already holds ${existing} key(s). Nothing to do. Use --force to overwrite it.`);
    return;
  }

  const { raw, restored } = readOldSecret(args, oldId);
  if (!raw) {
    console.log(`No old secret named ${oldId} was found (or it has expired). Nothing to move.`);
    return;
  }
  const moving = countKeys(raw);
  if (moving === 0) {
    console.log("The old secret holds no keys. Nothing to move.");
  } else {
    // The value goes through a private temporary file, so it never appears in a command line.
    const dir = mkdtempSync(path.join(os.tmpdir(), "securemind-keys-"));
    const file = path.join(dir, "value.json");
    try {
      writeFileSync(file, raw, { mode: 0o600 });
      aws(
        ["ssm", "put-parameter", "--name", paramName, "--type", "SecureString", "--tier", "Advanced", "--overwrite", "--value", `file://${file.replace(/\\/g, "/")}`],
        { ...args, stdio: "pipe", encoding: "utf8" },
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    console.log(`Moved ${moving} key(s) to ${paramName}.`);
  }

  if (restored) {
    aws(["secretsmanager", "delete-secret", "--secret-id", oldId, "--recovery-window-in-days", "7"], { ...args, stdio: "pipe", encoding: "utf8" });
    console.log("The old secret was scheduled for deletion again (7-day recovery window).");
  }
}

main();
