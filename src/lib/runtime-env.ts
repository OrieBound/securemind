/**
 * Runtime / deploy-shape helpers shared by Next routes and Lambda handlers.
 */

/** True when running inside an AWS Lambda execution environment. */
export function isLambdaRuntime(): boolean {
  return Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);
}

/**
 * Hosted/cloud install (Amplify, Lambda, or an explicit edition flag).
 * Local `npm run dev` and Docker Compose stay "local" even with Cognito.
 */
export function isHostedRuntime(): boolean {
  if (process.env.SECUREMIND_EDITION === "cloud" || process.env.SECUREMIND_EDITION === "hosted") {
    return true;
  }
  if (process.env.SECUREMIND_EDITION === "local") return false;
  return isLambdaRuntime() || Boolean(process.env.AMPLIFY_HOSTING);
}

export type RuntimeEdition = "local" | "cloud";

export function runtimeEdition(): RuntimeEdition {
  return isHostedRuntime() ? "cloud" : "local";
}

export function runtimeDeployment(): "docker" | "host" | "hosted" {
  if (isHostedRuntime()) return "hosted";
  return process.env.SECUREMIND_RUNTIME === "docker" ? "docker" : "host";
}

/**
 * Document chunk embedding must finish before the handler returns on Lambda,
 * or be delegated to a second invocation. Local Next may still background it
 * for snappier uploads unless DOCUMENT_INGEST_SYNC=true.
 */
export function shouldSyncDocumentIngest(): boolean {
  if (process.env.DOCUMENT_INGEST_SYNC === "true" || process.env.DOCUMENT_INGEST_SYNC === "1") {
    return true;
  }
  return isLambdaRuntime() || isHostedRuntime();
}

export type StorageBackendName = "postgres" | "dynamodb";

/**
 * Data plane for Knowledge vectors. Local default: Postgres + pgvector.
 * DynamoDB is the hosted AWS target (ADR 0007) and is opt-in until Phase 5 wires it.
 */
export function resolveStorageBackend(): StorageBackendName {
  const raw = (process.env.STORAGE_BACKEND ?? "").toLowerCase().trim();
  if (raw === "dynamodb") return "dynamodb";
  return "postgres";
}

export type EmbedProviderName = "ollama" | "bedrock";

/**
 * Embedding backend. Local default: Ollama. Cloud/Lambda default: Bedrock
 * unless overridden. Ollama is never assumed available in Lambda.
 */
export function resolveEmbedProvider(): EmbedProviderName {
  const raw = (process.env.EMBED_PROVIDER ?? "").toLowerCase().trim();
  if (raw === "ollama" || raw === "bedrock") return raw;
  if (isLambdaRuntime() || isHostedRuntime()) return "bedrock";
  return "ollama";
}
