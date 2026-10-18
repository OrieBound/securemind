/**
 * Bootstrap secrets from AWS Secrets Manager (hosted path).
 *
 * Model (see infra/README.md):
 *   - Systems Manager Parameter Store (SecureString) holds the instance encryption key and
 *     setup code (APP_SECRETS_PARAM), the Admin-pasted vendor keys (VENDOR_KEYS_PARAM) and
 *     the optional deploy-time Groq key (GROQ_API_KEY_PARAM). Standard parameters have no
 *     monthly charge, which is why they are used instead of Secrets Manager ($0.40 each).
 *   - A reference can still be a Secrets Manager ARN (APP_SECRETS_ARN, GROQ_SECRET_ARN), so an
 *     install that has not moved yet keeps working. The parameter name wins when both are set.
 *   - AWS credential material is never accepted via the UI (aws-credentials.ts).
 *
 * Call ensureRuntimeEnvFromSecrets() once before first DB or DynamoDB use in Lambda.
 * The Next.js server calls it at startup (src/instrumentation.ts).
 *
 * APP_SECRETS_PARAM points at one JSON value holding the instance encryption key and the
 * first-run setup code. They used to be plain Amplify environment variables, readable by
 * anyone with console access. Their values are unchanged, only where they are stored.
 */

import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { withRealAwsEndpoints } from "@/lib/aws-credentials";

let hydration: Promise<void> | null = null;

/** Names of the process variables filled from the app secret, and the JSON key for each. */
const APP_SECRET_FIELDS: ReadonlyArray<readonly [envName: string, jsonKey: string]> = [
  ["INSTANCE_ENCRYPTION_KEY", "instanceEncryptionKey"],
  ["SETUP_CLAIM_SECRET", "setupClaimSecret"],
];

/** Test hook: forget that hydration ran. */
export function resetSecretsHydrationForTests(): void {
  hydration = null;
}

/** Where a stored value lives: a Parameter Store name, or a Secrets Manager ARN or name. */
export type SecretRef = { kind: "ssm" | "sm"; id: string };

/** The parameter name wins over the ARN when both are set. Null when neither is. */
export function secretRef(paramVar: string, arnVar: string): SecretRef | null {
  const param = process.env[paramVar]?.trim();
  if (param) return { kind: "ssm", id: param };
  const arn = process.env[arnVar]?.trim();
  return arn ? { kind: "sm", id: arn } : null;
}

function region(): string {
  return (
    process.env.AWS_REGION ||
    process.env.AWS_DEFAULT_REGION ||
    process.env.COGNITO_REGION ||
    "us-east-1"
  );
}

function client(): SecretsManagerClient {
  return new SecretsManagerClient({ region: region() });
}

/** The stored string for a reference, or null when it has none. Never logs the value. */
async function readRaw(ref: SecretRef): Promise<string | null> {
  return withRealAwsEndpoints(async () => {
    if (ref.kind === "ssm") {
      const out = await new SSMClient({ region: region() }).send(
        new GetParameterCommand({ Name: ref.id, WithDecryption: true }),
      );
      return out.Parameter?.Value ?? null;
    }
    const out = await client().send(new GetSecretValueCommand({ SecretId: ref.id }));
    return out.SecretString ?? null;
  });
}

async function getSecretString(ref: SecretRef): Promise<string | null> {
  const raw = (await readRaw(ref))?.trim();
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
}

async function getSecretJson(ref: SecretRef): Promise<Record<string, unknown> | null> {
  const raw = (await readRaw(ref))?.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Fill the instance encryption key and setup code from APP_SECRETS_PARAM (or the older
 * APP_SECRETS_ARN). A value already in
 * the environment wins (local development, or an operator override). Returns the variable
 * NAMES that were set, never the values.
 */
export async function hydrateAppSecrets(): Promise<string[]> {
  const ref = secretRef("APP_SECRETS_PARAM", "APP_SECRETS_ARN");
  if (!ref) return [];
  const needed = APP_SECRET_FIELDS.filter(([envName]) => !process.env[envName]?.trim());
  if (needed.length === 0) return [];

  const json = await getSecretJson(ref);
  if (!json) throw new Error("The app secret (APP_SECRETS_PARAM or APP_SECRETS_ARN) is empty or is not a JSON object.");
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
    const url = await getSecretString({ kind: "sm", id: dbArn });
    if (url) process.env.DATABASE_URL = url;
  }

  const groqRef = secretRef("GROQ_API_KEY_PARAM", "GROQ_SECRET_ARN");
  if (groqRef && !process.env.GROQ_API_KEY?.trim()) {
    const key = await getSecretString(groqRef);
    if (key) process.env.GROQ_API_KEY = key;
  }

  const fragmentsArn = process.env.FRAGMENTS_TABLE_SECRET_ARN?.trim();
  if (fragmentsArn && !process.env.DYNAMODB_FRAGMENTS_TABLE?.trim()) {
    const name = await getSecretString({ kind: "sm", id: fragmentsArn });
    if (name) process.env.DYNAMODB_FRAGMENTS_TABLE = name;
  }
}
