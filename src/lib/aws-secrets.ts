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
 */

import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { withRealAwsEndpoints } from "@/lib/aws-credentials";

let hydrated = false;

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

/**
 * Hydrate process.env from Secrets Manager ARNs when env vars are empty.
 * No-op when ARNs are unset (local Neon .env.local path).
 */
export async function ensureRuntimeEnvFromSecrets(): Promise<void> {
  if (hydrated) return;
  hydrated = true;

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
