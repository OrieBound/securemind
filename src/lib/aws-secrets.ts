/**
 * Bootstrap secrets from AWS Secrets Manager (hosted path).
 *
 * Model (see infra/README.md):
 *   - Secrets Manager holds operator bootstrap (fragments table name, optional
 *     deploy-time GROQ_API_KEY) and Admin-pasted vendor keys (VENDOR_KEYS_SECRET_ARN).
 *   - AWS credential material is never accepted via the UI (aws-credentials.ts).
 *
 * Set DATABASE_SECRET_ARN / GROQ_SECRET_ARN / FRAGMENTS_TABLE_SECRET_ARN.
 * Call ensureRuntimeEnvFromSecrets() once before first DB or DynamoDB use in Lambda.
 * The Next.js server calls it at startup (src/instrumentation.ts).
 *
 * APP_SECRETS_ARN points at one JSON secret holding the instance encryption key and the
 * first-run setup code. They used to be plain Amplify environment variables, readable by
 * anyone with console access. Their values are unchanged, only where they are stored.
 */

import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { withRealAwsEndpoints } from "@/lib/aws-credentials";

let hydration: Promise<void> | null = null;

/** Names of the process variables filled from APP_SECRETS_ARN, and the JSON key for each. */
const APP_SECRET_FIELDS: ReadonlyArray<readonly [envName: string, jsonKey: string]> = [
  ["INSTANCE_ENCRYPTION_KEY", "instanceEncryptionKey"],
  ["SETUP_CLAIM_SECRET", "setupClaimSecret"],
];

/** Test hook: forget that hydration ran. */
export function resetSecretsHydrationForTests(): void {
  hydration = null;
}

function client(): SecretsManagerClient {
  return new SecretsManagerClient({
    region:
      process.env.AWS_REGION ||
      process.env.AWS_DEFAULT_REGION ||
      process.env.COGNITO_REGION ||
      "us-east-1",
  });
}

async function getSecretString(secretId: string): Promise<string | null> {
  return withRealAwsEndpoints(async () => {
    const out = await client().send(
      new GetSecretValueCommand({ SecretId: secretId }),
    );
    const raw = out.SecretString?.trim();
    if (!raw || raw === " ") return null;
    // Allow either plain string or {"url":"..."} / {"apiKey":"..."}
    if (raw.startsWith("{")) {
      try {
        const obj = JSON.parse(raw) as Record<string, unknown>;
        for (const key of ["url", "databaseUrl", "DATABASE_URL", "tableName", "apiKey", "groqApiKey", "value"]) {
          const v = obj[key];
          if (typeof v === "string" && v.trim()) return v.trim();
        }
      } catch {
        /* treat as plain */
      }
    }
    return raw;
  });
}

async function getSecretJson(secretId: string): Promise<Record<string, unknown> | null> {
  return withRealAwsEndpoints(async () => {
    const out = await client().send(new GetSecretValueCommand({ SecretId: secretId }));
    const raw = out.SecretString?.trim();
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  });
}

/**
 * Fill the instance encryption key and setup code from APP_SECRETS_ARN. A value already in
 * the environment wins (local development, or an operator override). Returns the variable
 * NAMES that were set, never the values.
 */
export async function hydrateAppSecrets(): Promise<string[]> {
  const arn = process.env.APP_SECRETS_ARN?.trim();
  if (!arn) return [];
  const needed = APP_SECRET_FIELDS.filter(([envName]) => !process.env[envName]?.trim());
  if (needed.length === 0) return [];

  const json = await getSecretJson(arn);
  if (!json) throw new Error("APP_SECRETS_ARN secret is empty or is not a JSON object.");
  const set: string[] = [];
  for (const [envName, jsonKey] of needed) {
    const value = json[jsonKey];
    if (typeof value === "string" && value.trim()) {
      process.env[envName] = value.trim();
      set.push(envName);
    }
  }
  return set;
}

/**
 * Hydrate process.env from Secrets Manager ARNs when env vars are empty.
 * No-op when ARNs are unset (local Neon .env.local path). Safe to call many times: the work
 * runs once, and a failed attempt is forgotten so the next call retries.
 */
export function ensureRuntimeEnvFromSecrets(): Promise<void> {
  if (!hydration) {
    hydration = hydrateRuntimeEnv().catch(err => {
      hydration = null;
      throw err;
    });
  }
  return hydration;
}

async function hydrateRuntimeEnv(): Promise<void> {
  await hydrateAppSecrets();

  const dbArn = process.env.DATABASE_SECRET_ARN?.trim();
  if (dbArn && !process.env.DATABASE_URL?.trim()) {
    const url = await getSecretString(dbArn);
    if (url) process.env.DATABASE_URL = url;
  }

  const groqArn = process.env.GROQ_SECRET_ARN?.trim();
  if (groqArn && !process.env.GROQ_API_KEY?.trim()) {
    const key = await getSecretString(groqArn);
    if (key) process.env.GROQ_API_KEY = key;
  }

  const fragmentsArn = process.env.FRAGMENTS_TABLE_SECRET_ARN?.trim();
  if (fragmentsArn && !process.env.DYNAMODB_FRAGMENTS_TABLE?.trim()) {
    const name = await getSecretString(fragmentsArn);
    if (name) process.env.DYNAMODB_FRAGMENTS_TABLE = name;
  }
}
