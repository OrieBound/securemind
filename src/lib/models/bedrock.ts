/**
 * Optional Amazon Bedrock chat provider.
 *
 * Active only when MODEL_PROVIDER=bedrock (or a tier routes to bedrock) and
 * AWS credentials are available. Points at real AWS by default; for local
 * Floci set AWS_ENDPOINT_URL=http://localhost:4566 — note Floci's Bedrock
 * Runtime support is stubbed, so expect limited local fidelity.
 *
 * Groq remains the primary production path for this personal project.
 */

import type { ChatMessage } from "./types";

export function isBedrockConfigured(): boolean {
  return Boolean(
    process.env.AWS_ACCESS_KEY_ID &&
      process.env.AWS_SECRET_ACCESS_KEY &&
      (process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION),
  );
}

function region(): string {
  return process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
}

/**
 * Stream a chat completion from Bedrock ConverseStream.
 * Uses the Messages / Converse API shape (Claude, Llama, etc. via model id).
 */
export async function* streamBedrockChat(
  messages: ChatMessage[],
  modelId: string,
): AsyncGenerator<string> {
  if (!isBedrockConfigured()) {
    throw new Error(
      "Bedrock is not configured. Set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and AWS_REGION.",
    );
  }

  // Dynamic import keeps cold paths that never touch Bedrock lighter.
  const { BedrockRuntimeClient, ConverseStreamCommand } = await import(
    "@aws-sdk/client-bedrock-runtime"
  );

  const endpoint = process.env.AWS_ENDPOINT_URL || process.env.AWS_ENDPOINT_URL_BEDROCK;
  const client = new BedrockRuntimeClient({
    region: region(),
    ...(endpoint ? { endpoint } : {}),
  });

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

  // Converse requires the conversation to start with a user turn.
  if (converseMessages.length === 0 || converseMessages[0].role !== "user") {
    converseMessages.unshift({ role: "user", content: [{ text: "(continue)" }] });
  }

  const response = await client.send(
    new ConverseStreamCommand({
      modelId,
      messages: converseMessages,
      ...(systemParts.length
        ? { system: [{ text: systemParts.join("\n\n") }] }
        : {}),
    }),
  );

  if (!response.stream) {
    throw new Error("Bedrock ConverseStream returned no stream.");
  }

  for await (const event of response.stream) {
    const delta = event.contentBlockDelta?.delta?.text;
    if (delta) yield delta;
  }
}
