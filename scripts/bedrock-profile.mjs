#!/usr/bin/env node
/**
 * Share ONE AWS CLI profile with the Docker app so it can use Amazon Bedrock.
 *
 *   aws sso login --profile <name>
 *   npm run bedrock:profile -- <name>
 *   docker compose -f docker-compose.yml -f docker-compose.bedrock.yml up -d
 *
 * It writes ./aws-profile (git-ignored) holding only that profile, its sso-session and its current
 * sign-in token, never the rest of ~/.aws. Run it again after you sign in again; no restart needed.
 * Profiles that use access keys are refused. SecureMind never stores or copies AWS keys.
 */
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { readFileSync } from "node:fs";
import { extractProfile } from "./lib/aws-profile-export.mjs";

const name = process.argv[2];
if (!name || name.startsWith("-")) {
  console.error("Usage: npm run bedrock:profile -- <aws-profile-name>");
  process.exit(1);
}

const awsDir = process.env.AWS_CONFIG_FILE ? resolve(process.env.AWS_CONFIG_FILE, "..") : join(homedir(), ".aws");
const configPath = process.env.AWS_CONFIG_FILE || join(awsDir, "config");
if (!existsSync(configPath)) {
  console.error(`No AWS config at ${configPath}. Run: aws configure sso`);
  process.exit(1);
}

const result = extractProfile(readFileSync(configPath, "utf8"), name);
if (!result.ok) {
  console.error(result.reason);
  process.exit(1);
}

const cacheSource = join(awsDir, "sso", "cache", result.cacheFile);
if (!existsSync(cacheSource)) {
  console.error(`No sign-in found for "${name}". Run this first, then try again:\n  aws sso login --profile ${name}`);
  process.exit(1);
}

const dest = resolve(process.env.SECUREMIND_AWS_DIR || "aws-profile");
mkdirSync(join(dest, "sso", "cache"), { recursive: true });
writeFileSync(join(dest, "config"), result.text, { mode: 0o600 });
copyFileSync(cacheSource, join(dest, "sso", "cache", result.cacheFile));

console.log(`Shared profile "${name}" with Docker in ${dest}`);
console.log("Next, if the app is not already started with the Bedrock file:");
console.log("  docker compose -f docker-compose.yml -f docker-compose.bedrock.yml up -d");
console.log("Then open Settings, Models, Amazon Bedrock, and press Re-check host.");
console.log("When the AWS sign-in expires, run aws sso login and this command again.");
