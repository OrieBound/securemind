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

/**
 * Chat OPTIONS is a MOCK (not Lambda). Preflight never sees Lambda ALLOWED_ORIGIN.
 * Without this patch, the browser reports Failed to fetch and the UI used to say
 * "confirm the dev server is running".
 */
function updateApiGatewayChatCors(apiBaseUrl, allowedOrigin) {
  const host = apiBaseUrl.replace(/^https?:\/\//, "").split("/")[0];
  const restApiId = host.split(".")[0];
  if (!restApiId) {
    console.warn("Could not parse API id from", apiBaseUrl);
    return;
  }
  const resources = awsJson(["apigateway", "get-resources", "--rest-api-id", restApiId]);
  const chat = (resources?.items || []).find((r) => r.path === "/chat");
  if (!chat?.id) {
    console.warn("No /chat resource on API", restApiId);
    return;
  }
  const patchFile = path.join(ROOT, "infra/terraform/.build/cors-patch.json");
  writeFileSync(
    patchFile,
    JSON.stringify({
      restApiId,
      resourceId: chat.id,
      httpMethod: "OPTIONS",
      statusCode: "200",
      patchOperations: [
        {
          op: "replace",
          path: "/responseParameters/method.response.header.Access-Control-Allow-Origin",
          value: `'${allowedOrigin}'`,
        },
      ],
    }),
  );
  aws([
    "apigateway",
    "update-integration-response",
    "--cli-input-json",
    `file://${patchFile.replace(/\\/g, "/")}`,
  ]);
  aws([
    "apigateway",
    "create-deployment",
    "--rest-api-id",
    restApiId,
    "--stage-name",
    "prod",
    "--description",
    `CORS origin ${allowedOrigin}`,
  ]);
  console.log(`API Gateway /chat OPTIONS Allow-Origin=${allowedOrigin}`);
}

function updateAmplifyEnv({ appId, branch, apiBaseUrl, authOut, region }) {
  if (!appId) return;

  const existing = awsJson(["amplify", "get-app", "--app-id", appId]);
  const current = existing?.app?.environmentVariables || {};

  const envVars = {
    ...current,
    NEXT_PUBLIC_API_BASE_URL: apiBaseUrl || current.NEXT_PUBLIC_API_BASE_URL || "",
    AUTH_MODE: process.env.AUTH_MODE || current.AUTH_MODE || "cognito",
    AUTH_ALLOW_LOCAL_FALLBACK: "false",
    COGNITO_USER_POOL_ID: authOut.UserPoolId || current.COGNITO_USER_POOL_ID || "",
    COGNITO_CLIENT_ID: authOut.ClientId || current.COGNITO_CLIENT_ID || "",
    COGNITO_REGION: process.env.COGNITO_REGION || region || current.COGNITO_REGION || "",
    COGNITO_ISSUER: authOut.Issuer || current.COGNITO_ISSUER || "",
  };

  const map = Object.entries(envVars)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${v}`)
    .join(",");
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
      const branchDesc = awsJson([
        "amplify",
        "get-branch",
        "--app-id",
        appId,
        "--branch-name",
        branch,
      ]);
      const branchEnv = {
        ...(branchDesc?.branch?.environmentVariables || {}),
        ...envVars,
      };
      const branchMap = Object.entries(branchEnv)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => `${k}=${v}`)
        .join(",");
      aws([
        "amplify",
        "update-branch",
        "--app-id",
        appId,
        "--branch-name",
        branch,
        "--environment-variables",
        branchMap,
      ]);
    }
  }
  console.log(`Amplify app ${appId} env updated (API + Cognito; existing secrets kept).`);
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
    updateApiGatewayChatCors(apiOut.ApiBaseUrl, siteUrl);
  }

  updateAmplifyEnv({
    appId: amplifyOut.AmplifyAppId,
    branch: siteUrl ? branch : null,
    apiBaseUrl: apiOut.ApiBaseUrl,
    authOut,
    region: args.region,
  });

  console.log(`
Wired.
  API:     ${apiOut.ApiBaseUrl}
  Cognito: ${authOut.UserPoolId}
  UI:      ${siteUrl || "(connect Amplify branch, then npm run infra:wire)"}
  Console: ${amplifyOut.AmplifyConsoleHint || ""}

First admin (hosted): open the UI. The setup code is only in Terraform:
  terraform -chdir=infra/terraform output -raw setup_claim_secret
Do not print that value on the public page. Do not use ADMIN_EMAIL to seed a user.
`);
}

main();
