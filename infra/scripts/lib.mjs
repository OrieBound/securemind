/**
 * Shared AWS CLI helpers for infra scripts.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const INFRA = path.join(ROOT, "infra");
export const TF_DIR = path.join(INFRA, "terraform");
export const TF_BACKEND_HCL = path.join(TF_DIR, "backend.hcl");

export function fail(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

export function stackName(kind, envName) {
  return `securemind-${kind}-${envName}`;
}

export function loadDeployEnv(filePath) {
  if (!existsSync(filePath)) return false;
  const text = readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
  return true;
}

export function resolveDeployEnvPath() {
  const named = process.env.SECUREMIND_DEPLOY_ENV;
  if (named) return path.isAbsolute(named) ? named : path.join(ROOT, named);
  return path.join(ROOT, ".env.deploy");
}

export function commonArgsFromEnv() {
  return {
    envName: process.env.ENV_NAME || "sandbox",
    region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1",
    profile: process.env.AWS_PROFILE || "",
    databaseMode: process.env.DATABASE_MODE || "dynamodb",
  };
}

export function run(cmd, args, opts = {}) {
  console.log(`\n> ${cmd} ${args.join(" ")}\n`);
  const r = spawnSync(cmd, args, {
    stdio: opts.stdio ?? "inherit",
    encoding: opts.encoding,
    shell: process.platform === "win32",
    cwd: opts.cwd || ROOT,
    env: { ...process.env, ...opts.env },
  });
  if ((opts.check ?? true) && r.status !== 0) {
    fail(`${cmd} exited ${r.status}`);
  }
  return r;
}

export function aws(argsList, opts = {}) {
  const { region, profile } = { ...commonArgsFromEnv(), ...opts };
  const cli = [...argsList];
  if (!cli.includes("--region")) cli.push("--region", region);
  if (profile && !cli.includes("--profile")) cli.push("--profile", profile);
  return run("aws", cli, { check: opts.check ?? true, stdio: opts.stdio, encoding: opts.encoding });
}

export function awsJson(argsList, opts = {}) {
  const r = aws([...argsList, "--output", "json"], {
    ...opts,
    check: false,
    stdio: ["pipe", "pipe", "inherit"],
    encoding: "utf8",
  });
  if (r.status !== 0) return null;
  try {
    return JSON.parse(r.stdout || "{}");
  } catch {
    return null;
  }
}

export function stackOutputs(kind, opts = {}) {
  const mapped = terraformOutputsMapped();
  if (Object.keys(mapped).length) {
    if (kind === "auth-cognito") {
      return {
        UserPoolId: mapped.user_pool_id,
        ClientId: mapped.client_id,
        Issuer: mapped.issuer,
      };
    }
    if (kind === "api") {
      return { ApiBaseUrl: mapped.api_base_url };
    }
    if (kind === "amplify") {
      return {
        AmplifyAppId: mapped.amplify_app_id,
        AmplifyDefaultDomain: mapped.amplify_default_domain,
        AmplifyConsoleHint: mapped.amplify_console_url,
      };
    }
  }
  const { envName } = { ...commonArgsFromEnv(), ...opts };
  const name = stackName(kind, envName);
  const data = awsJson(["cloudformation", "describe-stacks", "--stack-name", name], opts);
  const outputs = data?.Stacks?.[0]?.Outputs || [];
  const map = {};
  for (const o of outputs) map[o.OutputKey] = o.OutputValue;
  return map;
}

export function terraformEnv() {
  const { region, profile, envName } = commonArgsFromEnv();
  return {
    ...process.env,
    AWS_REGION: region,
    AWS_DEFAULT_REGION: region,
    ...(profile ? { AWS_PROFILE: profile } : {}),
    TF_VAR_aws_region: region,
    TF_VAR_env_name: envName,
    TF_VAR_groq_api_key: process.env.GROQ_API_KEY || "",
    TF_VAR_allowed_origin: process.env.ALLOWED_ORIGIN || process.env.AMPLIFY_SITE_URL || "http://localhost:3000",
    TF_VAR_amplify_branch: process.env.AMPLIFY_BRANCH || "main",
    TF_VAR_embed_dimensions: process.env.EMBED_DIMENSIONS || "1024",
    TF_VAR_auth_mode: process.env.AUTH_MODE || "cognito",
  };
}

export function terraform(argsList, opts = {}) {
  const tfArgs = [`-chdir=${TF_DIR}`, ...argsList];
  return run("terraform", tfArgs, {
    ...opts,
    env: { ...terraformEnv(), ...opts.env },
  });
}

export function terraformOutputsMapped() {
  const r = terraform(["output", "-json"], {
    check: false,
    stdio: ["pipe", "pipe", "inherit"],
    encoding: "utf8",
  });
  if (r.status !== 0 || !r.stdout) return {};
  try {
    const raw = JSON.parse(r.stdout);
    const map = {};
    for (const [k, v] of Object.entries(raw)) map[k] = v?.value;
    return map;
  } catch {
    return {};
  }
}

export function assertAwsIdentity(opts = {}) {
  const id = awsJson(["sts", "get-caller-identity"], opts);
  if (!id?.Account) {
    fail(
      "AWS SSO/credentials not usable. Run: aws sso login --profile <your-profile>  (and set AWS_PROFILE in .env.deploy)",
    );
  }
  console.log(`AWS identity: ${id.Arn}`);
  return id;
}
