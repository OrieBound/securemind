#!/usr/bin/env node
/**
 * Provision a Cognito user pool + app client on local Floci ($0, no AWS account).
 *
 * Prerequisites:
 *   docker compose up -d floci
 *   AWS CLI v2 installed
 *
 * Usage:
 *   node scripts/floci-cognito-setup.mjs
 *
 * Writes scripts/.floci-cognito.env (gitignored) and prints .env.local lines.
 * The same Pool Id / Client Id / Issuer shape is what you recreate in real AWS later.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ENDPOINT = process.env.AWS_ENDPOINT_URL || "http://localhost:4566";
const REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
const POOL_NAME = "SecureMindLocal";
const CLIENT_NAME = "securemind-web";
const DEMO_PASSWORD = "<demo-password>!";
/** Legacy single demo user (Admin). Prefer admin@ / member@ for role tests. */
const DEMO_EMAIL = "demo@securemind.local";
const ADMIN_EMAIL = "admin@example.test";
const MEMBER_EMAIL = "member@securemind.local";
const GROUP_ADMIN = "Admin";
const GROUP_MEMBER = "Member";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outFile = process.env.OUT_FILE || join(root, "scripts", ".floci-cognito.env");

function aws(args) {
  const env = {
    ...process.env,
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID || "test",
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY || "test",
    AWS_DEFAULT_REGION: REGION,
    AWS_REGION: REGION,
    // Prevent accidental real-AWS calls if the CLI ignores endpoint flags.
    AWS_EC2_METADATA_DISABLED: "true",
  };
  // Always pass --endpoint-url: Debian awscli 2.9 in the init image does not
  // honor AWS_ENDPOINT_URL, which caused UnrecognizedClientException against real AWS.
  const fullArgs = ["--endpoint-url", ENDPOINT, ...args];
  const r = spawnSync("aws", fullArgs, { encoding: "utf8", env, shell: false });
  if (r.status !== 0) {
    throw new Error(`aws ${fullArgs.join(" ")}\n${r.stderr || r.stdout}`);
  }
  return (r.stdout || "").trim();
}

function main() {
  console.log(`Floci endpoint: ${ENDPOINT}`);

  // Reuse an existing pool with the same name when possible.
  let poolId = "";
  try {
    const listed = JSON.parse(
      aws(["cognito-idp", "list-user-pools", "--max-results", "20", "--output", "json"]),
    );
    const existing = (listed.UserPools || []).find(p => p.Name === POOL_NAME);
    if (existing) poolId = existing.Id;
  } catch {
    /* create below */
  }

  if (!poolId) {
    poolId = aws([
      "cognito-idp", "create-user-pool",
      "--pool-name", POOL_NAME,
      "--username-attributes", "email",
      "--auto-verified-attributes", "email",
      "--policies", "PasswordPolicy={MinimumLength=8,RequireUppercase=false,RequireLowercase=false,RequireNumbers=false,RequireSymbols=false}",
      "--query", "UserPool.Id",
      "--output", "text",
    ]);
    console.log(`Created user pool: ${poolId}`);
  } else {
    console.log(`Reusing user pool: ${poolId}`);
  }

  let clientId = "";
  const clients = JSON.parse(
    aws([
      "cognito-idp", "list-user-pool-clients",
      "--user-pool-id", poolId,
      "--max-results", "20",
      "--output", "json",
    ]),
  );
  const existingClient = (clients.UserPoolClients || []).find(c => c.ClientName === CLIENT_NAME);
  if (existingClient) {
    clientId = existingClient.ClientId;
    console.log(`Reusing app client: ${clientId}`);
  } else {
    clientId = aws([
      "cognito-idp", "create-user-pool-client",
      "--user-pool-id", poolId,
      "--client-name", CLIENT_NAME,
      "--explicit-auth-flows", "ALLOW_USER_PASSWORD_AUTH", "ALLOW_REFRESH_TOKEN_AUTH", "ALLOW_USER_SRP_AUTH",
      "--prevent-user-existence-errors", "ENABLED",
      "--query", "UserPoolClient.ClientId",
      "--output", "text",
    ]);
    console.log(`Created app client: ${clientId}`);
  }

  for (const groupName of [GROUP_ADMIN, GROUP_MEMBER]) {
    try {
      aws([
        "cognito-idp", "create-group",
        "--user-pool-id", poolId,
        "--group-name", groupName,
        "--description", `SecureMind ${groupName} local Floci`,
      ]);
      console.log(`Created group: ${groupName}`);
    } catch (err) {
      if (/GroupExistsException|already exists/i.test(String(err.message))) {
        console.log(`Group already exists: ${groupName}`);
      } else {
        console.warn(`create-group ${groupName}:`, String(err.message).slice(0, 200));
      }
    }
  }

  function ensureUser(email, groups) {
    try {
      aws([
        "cognito-idp", "admin-create-user",
        "--user-pool-id", poolId,
        "--username", email,
        "--user-attributes", `Name=email,Value=${email}`, "Name=email_verified,Value=true",
        "--message-action", "SUPPRESS",
      ]);
      console.log(`Created user: ${email}`);
    } catch (err) {
      if (!String(err.message).includes("UsernameExistsException")) {
        console.warn(`admin-create-user ${email}:`, String(err.message).slice(0, 200));
      } else {
        console.log(`User already exists: ${email}`);
      }
    }
    aws([
      "cognito-idp", "admin-set-user-password",
      "--user-pool-id", poolId,
      "--username", email,
      "--password", DEMO_PASSWORD,
      "--permanent",
    ]);
    for (const groupName of groups) {
      try {
        aws([
          "cognito-idp", "admin-add-user-to-group",
          "--user-pool-id", poolId,
          "--username", email,
          "--group-name", groupName,
        ]);
      } catch (err) {
        if (!/already|exists/i.test(String(err.message))) {
          console.warn(`add-to-group ${email}→${groupName}:`, String(err.message).slice(0, 160));
        }
      }
    }
  }

  ensureUser(ADMIN_EMAIL, [GROUP_ADMIN]);
  ensureUser(MEMBER_EMAIL, [GROUP_MEMBER]);
  ensureUser(DEMO_EMAIL, [GROUP_ADMIN]);

  const issuer = `${ENDPOINT.replace(/\/$/, "")}/${poolId}`;
  const jwks = `${issuer}/.well-known/jwks.json`;

  const envBody = [
    `# Generated by scripts/floci-cognito-setup.mjs — do not commit`,
    `AUTH_MODE=cognito`,
    `AUTH_ALLOW_LOCAL_FALLBACK=false`,
    `AWS_ENDPOINT_URL=${ENDPOINT}`,
    `AWS_ACCESS_KEY_ID=test`,
    `AWS_SECRET_ACCESS_KEY=test`,
    `AWS_REGION=${REGION}`,
    `AWS_DEFAULT_REGION=${REGION}`,
    `COGNITO_REGION=${REGION}`,
    `COGNITO_USER_POOL_ID=${poolId}`,
    `COGNITO_CLIENT_ID=${clientId}`,
    `COGNITO_ISSUER=${issuer}`,
    `COGNITO_JWKS_URL=${jwks}`,
    `# Logins (password ${DEMO_PASSWORD}):`,
    `#   Admin:  ${ADMIN_EMAIL}  (group ${GROUP_ADMIN})`,
    `#   Member: ${MEMBER_EMAIL} (group ${GROUP_MEMBER})`,
    `#   Legacy: ${DEMO_EMAIL}   (group ${GROUP_ADMIN})`,
    "",
  ].join("\n");

  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, envBody, "utf8");
  console.log(`Wrote ${outFile}`);

  if (!process.env.OUT_FILE) {
    console.log("\n--- Add these to .env.local (Neon/Groq lines stay as they are) ---\n");
    console.log(envBody);
    console.log("\nSame values to recreate later in real AWS Cognito:");
    console.log(`  User pool name: ${POOL_NAME}`);
    console.log(`  App client name: ${CLIENT_NAME} (USER_PASSWORD_AUTH, no secret)`);
    console.log(`  Issuer shape:   https://cognito-idp.<region>.amazonaws.com/<poolId>`);
    console.log(`  (Floci uses):   ${issuer}`);
  }
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
