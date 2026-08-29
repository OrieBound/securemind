#!/usr/bin/env node
/**
 * Wire Amplify URL into Cognito callbacks + API CORS + Amplify env.
 * Idempotent — safe to re-run after Amplify gets a branch URL.
 */

import { writeFileSync } from "node:fs";
import path from "node:path";
import {
  ROOT,
  assertAwsIdentity,
  aws,
  awsJson,
  commonArgsFromEnv,
  fail,
  loadDeployEnv,
  resolveDeployEnvPath,
  stackOutputs,
} from "./lib.mjs";

function uniq(list) {
  return [...new Set(list.filter(Boolean))];
}

function amplifySiteUrl(amplifyOut, branch) {
  const domain = amplifyOut.AmplifyDefaultDomain?.replace(/^https?:\/\//, "");
  if (!domain) return null;
  // With a connected branch: https://main.dxxx.amplifyapp.com
  // Without branch yet: only the app default domain exists — still useful for later.
  if (branch) return `https://${branch}.${domain}`;
  return null;
}

function updateCognitoClient({ poolId, clientId, urls }) {
  const described = awsJson([
    "cognito-idp",
    "describe-user-pool-client",
    "--user-pool-id",
    poolId,
    "--client-id",
    clientId,
  ]);
  const client = described?.UserPoolClient;
  if (!client) fail("Could not describe Cognito user pool client.");

  const callback = uniq([
    ...(client.CallbackURLs || []),
    ...urls,
    "http://localhost:3000/",
    "http://localhost:3000/login",
  ]);
  const logout = uniq([
    ...(client.LogoutURLs || []),
    ...urls,
    "http://localhost:3000/",
    "http://localhost:3000/login",
  ]);

  const args = [
    "cognito-idp",
    "update-user-pool-client",
    "--user-pool-id",
    poolId,
    "--client-id",
    clientId,
    "--callback-urls",
    ...callback,
    "--logout-urls",
    ...logout,
    "--explicit-auth-flows",
    ...(client.ExplicitAuthFlows || [
      "ALLOW_USER_PASSWORD_AUTH",
      "ALLOW_USER_SRP_AUTH",
      "ALLOW_REFRESH_TOKEN_AUTH",
    ]),
    "--supported-identity-providers",
    ...(client.SupportedIdentityProviders || ["COGNITO"]),
    "--prevent-user-existence-errors",
    client.PreventUserExistenceErrors || "ENABLED",
  ];

  if (client.AllowedOAuthFlows?.length) {
    args.push("--allowed-o-auth-flows", ...client.AllowedOAuthFlows);
    args.push("--allowed-o-auth-scopes", ...(client.AllowedOAuthScopes || ["email", "openid", "profile"]));
    args.push("--allowed-o-auth-flows-user-pool-client");
  }

  aws(args);
  console.log(`Cognito callbacks updated:\n  ${callback.join("\n  ")}`);
}

function updateLambdaCors(functionName, allowedOrigin) {
  const cfg = awsJson(["lambda", "get-function-configuration", "--function-name", functionName]);
  const vars = { ...(cfg?.Environment?.Variables || {}) };
  const existing = (vars.ALLOWED_ORIGIN || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  vars.ALLOWED_ORIGIN = uniq([...existing, "http://localhost:3000", allowedOrigin]).join(",");

  const envFile = path.join(ROOT, "infra/terraform/.build/lambda-env.json");
  writeFileSync(envFile, JSON.stringify({ Variables: vars }));
  aws([
    "lambda",
    "update-function-configuration",
    "--function-name",
    functionName,
    "--environment",
    `file://${envFile.replace(/\\/g, "/")}`,
  ]);
  console.log(`Lambda ${functionName} ALLOWED_ORIGIN=${vars.ALLOWED_ORIGIN}`);
}

function updateAmplifyEnv({ appId, branch, apiBaseUrl, authOut, region }) {
  if (!appId) return;

  const envVars = [
    { Name: "NEXT_PUBLIC_API_BASE_URL", Value: apiBaseUrl || "" },
    { Name: "AUTH_MODE", Value: process.env.AUTH_MODE || "cognito" },
    { Name: "AUTH_ALLOW_LOCAL_FALLBACK", Value: "false" },
    { Name: "COGNITO_USER_POOL_ID", Value: authOut.UserPoolId || "" },
    { Name: "COGNITO_CLIENT_ID", Value: authOut.ClientId || "" },
    { Name: "COGNITO_REGION", Value: process.env.COGNITO_REGION || region },
    { Name: "COGNITO_ISSUER", Value: authOut.Issuer || "" },
  ];

  // App-level (CLI map shorthand)
  const map = envVars.map((e) => `${e.Name}=${e.Value}`).join(",");
  aws(["amplify", "update-app", "--app-id", appId, "--environment-variables", map]);

  if (branch) {
    const listed = awsJson(["amplify", "list-branches", "--app-id", appId]);
    const hasBranch = (listed?.branches || []).some((b) => b.branchName === branch);
    if (hasBranch) {
      aws([
        "amplify",
        "update-branch",
        "--app-id",
        appId,
        "--branch-name",
        branch,
        "--no-enable-auto-build",
      ]);
      aws([
        "amplify",
        "update-branch",
        "--app-id",
        appId,
        "--branch-name",
        branch,
        "--environment-variables",
        map,
      ]);
    }
  }
  console.log(`Amplify app ${appId} env updated (API + Cognito).`);
}

function maybeInviteAdmin(authOut) {
  const email = process.env.ADMIN_EMAIL?.trim();
  if (!email || !authOut.UserPoolId) return;

  const temp =
    process.env.ADMIN_TEMP_PASSWORD?.trim() ||
    `Tmp-${Math.random().toString(36).slice(2, 10)}-Aa1`;

  const create = aws(
    [
      "cognito-idp",
      "admin-create-user",
      "--user-pool-id",
      authOut.UserPoolId,
      "--username",
      email,
      "--temporary-password",
      temp,
      "--user-attributes",
      `Name=email,Value=${email}`,
      "Name=email_verified,Value=true",
      "--message-action",
      "SUPPRESS",
    ],
    { check: false, stdio: "inherit" },
  );

  if (create.status !== 0) {
    console.log(`(admin invite skipped or user exists for ${email})`);
  } else {
    console.log(`Invited Admin user ${email} (temporary password printed once below).`);
    console.log(`  TEMP PASSWORD: ${temp}`);
    console.log("  User must change password on first sign-in.");
  }

  aws(
    [
      "cognito-idp",
      "admin-add-user-to-group",
      "--user-pool-id",
      authOut.UserPoolId,
      "--username",
      email,
      "--group-name",
      "Admin",
    ],
    { check: false, stdio: "inherit" },
  );
}

function main() {
  loadDeployEnv(resolveDeployEnvPath());
  const args = commonArgsFromEnv();
  assertAwsIdentity(args);

  const authOut = stackOutputs("auth-cognito", args);
  const apiOut = stackOutputs("api", args);
  const amplifyOut = stackOutputs("amplify", args);

  if (!authOut.UserPoolId || !authOut.ClientId) {
    fail("auth-cognito outputs missing — run npm run infra:up (Terraform) first.");
  }
  if (!apiOut.ApiBaseUrl) {
    fail("api outputs missing — run npm run infra:up first.");
  }

  const branch = process.env.AMPLIFY_BRANCH || "main";
  const siteUrl =
    process.env.AMPLIFY_SITE_URL?.replace(/\/$/, "") ||
    amplifySiteUrl(amplifyOut, branch);

  if (!siteUrl) {
    console.log(`
Amplify app exists but no branch URL yet.
  1) Connect the GitHub repo in Amplify console (or set AMPLIFY_CONNECT_REPO=true and re-up)
  2) Re-run: npm run infra:wire

Meanwhile Cognito still allows http://localhost:3000
API: ${apiOut.ApiBaseUrl}
`);
  } else {
    updateCognitoClient({
      poolId: authOut.UserPoolId,
      clientId: authOut.ClientId,
      urls: [`${siteUrl}/`, `${siteUrl}/login`],
    });

    const envName = args.envName;
    updateLambdaCors(`securemind-chat-${envName}`, siteUrl);
    updateLambdaCors(`securemind-warm-${envName}`, siteUrl);
  }

  updateAmplifyEnv({
    appId: amplifyOut.AmplifyAppId,
    branch: siteUrl ? branch : null,
    apiBaseUrl: apiOut.ApiBaseUrl,
    authOut,
    region: args.region,
  });

  maybeInviteAdmin(authOut);

  console.log(`
Wired.
  API:     ${apiOut.ApiBaseUrl}
  Cognito: ${authOut.UserPoolId}
  UI:      ${siteUrl || "(connect Amplify branch, then npm run infra:wire)"}
  Console: ${amplifyOut.AmplifyConsoleHint || ""}
`);
}

main();
