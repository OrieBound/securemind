/**
 * Amazon Bedrock chat provider (ConverseStream).
 *
 * Credentials are never taken from the UI or the database. The AWS SDK default
 * provider chain resolves them from the deployment environment — env vars,
 * a shared profile / SSO login, or a container/instance role. See
 * `src/lib/aws-credentials.ts`.
 *
 * Floci's AWS_ENDPOINT_URL must NOT reach this client — Bedrock streaming is
 * stubbed on Floci (501), and the SDK would otherwise pick the variable up
 * implicitly. `withRealAwsEndpoints()` hides it; only AWS_ENDPOINT_URL_BEDROCK
 * overrides the endpoint.
 */

import type { ChatMessage } from "./types";
import { withRealAwsEndpoints } from "@/lib/aws-credentials";
import {
  getInstanceAwsStatus,
  instanceCanUseBedrock,
  resolveRuntimeSecrets,
} from "@/lib/instance-config";

export async function isBedrockConfigured(): Promise<boolean> {
  return instanceCanUseBedrock();
}

/** Human-readable reason Bedrock is unavailable, or null when it is usable. */
export async function bedrockBlockReason(): Promise<string | null> {
  const status = await getInstanceAwsStatus();
  if (!status.allowRealAws) {
    return status.lockedByEnvironment
      ? "Billable AWS calls are blocked by ALLOW_REAL_AWS=false in the environment."
      : "Billable AWS calls are turned off. Enable them in Settings → Providers.";
  }
  if (status.looksLikeFloci) {
    return "Floci placeholder credentials are in use. Bedrock streaming requires real AWS credentials.";
  }
  if (!status.detected) {
    return "No AWS credentials found on this host. Sign in with the AWS CLI, then pick a profile in Settings → Providers.";
  }
  if (!status.region) {
    return "No AWS region configured. Choose one in Settings → Providers.";
  }
  return null;
}

/**
 * Stream a chat completion from Bedrock ConverseStream.
 */
export async function* streamBedrockChat(
  messages: ChatMessage[],
  modelId: string,
): AsyncGenerator<string> {
  const blocked = await bedrockBlockReason();
  if (blocked) throw new Error(blocked);

  const secrets = await resolveRuntimeSecrets();
  const status = await getInstanceAwsStatus();

  const systemParts: string[] = [];
  const converseMessages: Array<{
    role: "user" | "assistant";
    content: Array<{ text: string }>;
  }> = [];

  for (const m of messages) {
    const text = typeof m.content === "string"
      ? m.content
      : m.content
          .filter((p): p is { type: "text"; text: string } => p.type === "text")
          .map(p => p.text)
          .join("\n");

    if (m.role === "system") {
      systemParts.push(text);
      continue;
    }
    if (m.role !== "user" && m.role !== "assistant") continue;
    converseMessages.push({ role: m.role, content: [{ text }] });
  }

  if (converseMessages.length === 0 || converseMessages[0].role !== "user") {
    converseMessages.unshift({ role: "user", content: [{ text: "(continue)" }] });
  }

  // Client construction and dispatch both run with Floci's global endpoint
  // hidden, so a Floci-configured host cannot silently divert Bedrock traffic
  // to localhost. Only AWS_ENDPOINT_URL_BEDROCK may redirect it.
  const response = await withRealAwsEndpoints(async () => {
    const { BedrockRuntimeClient, ConverseStreamCommand } = await import(
      "@aws-sdk/client-bedrock-runtime"
    );
    const endpoint = process.env.AWS_ENDPOINT_URL_BEDROCK || undefined;
    const credentials = status.profile
      ? (await import("@aws-sdk/credential-providers")).fromNodeProviderChain({
          profile: status.profile,
        })
      : undefined;
    const client = new BedrockRuntimeClient({
      region: secrets.bedrockRegion,
      ...(credentials ? { credentials } : {}),
      ...(endpoint ? { endpoint } : {}),
    });
    return client.send(
      new ConverseStreamCommand({
        modelId,
        messages: converseMessages,
        ...(systemParts.length
          ? { system: [{ text: systemParts.join("\n\n") }] }
          : {}),
      }),
    );
  });

  if (!response.stream) {
    throw new Error("Bedrock ConverseStream returned no stream.");
  }

  for await (const event of response.stream) {
    const delta = event.contentBlockDelta?.delta?.text;
    if (delta) yield delta;
  }
}
