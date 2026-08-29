/**
 * Streaming chat Lambda for API Gateway REST response streaming.
 *
 * Localhost continues to use Next.js /api/chat.
 * Hydrate Secrets Manager bootstrap env before importing DB-backed chat code.
 */

import { getIdentity, IdentityError } from "../../src/lib/identity";
import type { ChatRequestBody } from "../../src/lib/chat/types";
import { apigwStreamPreamble } from "../../src/lib/chat/sse";
import { ensureRuntimeEnvFromSecrets } from "../../src/lib/aws-secrets";

type ApiGwEvent = {
  httpMethod?: string;
  path?: string;
  body?: string | null;
  headers?: Record<string, string | undefined>;
  multiValueHeaders?: Record<string, string[] | undefined>;
};

declare const awslambda: {
  streamifyResponse: (
    handler: (
      event: ApiGwEvent,
      responseStream: NodeJS.WritableStream,
      context: unknown,
    ) => Promise<void>,
  ) => unknown;
};

function corsOrigin(event: ApiGwEvent): string | null {
  const allowed = (process.env.ALLOWED_ORIGIN ?? "").split(",").map(s => s.trim()).filter(Boolean);
  const reqOrigin = event.headers?.origin ?? event.headers?.Origin ?? "";
  if (allowed.includes("*")) return reqOrigin || "*";
  if (reqOrigin && allowed.includes(reqOrigin)) return reqOrigin;
  return allowed[0] ?? null;
}

function requestFromEvent(event: ApiGwEvent): Request {
  const headers = new Headers();
  for (const [k, v] of Object.entries(event.headers ?? {})) {
    if (v) headers.set(k, v);
  }
  const cookies = event.multiValueHeaders?.Cookie ?? event.multiValueHeaders?.cookie;
  if (cookies?.length && !headers.has("cookie")) {
    headers.set("cookie", cookies.join("; "));
  }
  return new Request(`https://lambda.local${event.path ?? "/chat"}`, {
    method: event.httpMethod || "POST",
    headers,
    body: event.body && event.httpMethod !== "GET" ? event.body : undefined,
  });
}

async function writeJsonError(
  responseStream: NodeJS.WritableStream,
  statusCode: number,
  body: Record<string, unknown>,
  origin: string | null,
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Credentials"] = "true";
  }
  const meta = JSON.stringify({ statusCode, headers });
  responseStream.write(Buffer.concat([Buffer.from(meta, "utf8"), Buffer.alloc(8, 0)]));
  responseStream.write(Buffer.from(JSON.stringify(body), "utf8"));
  (responseStream as NodeJS.WritableStream & { end: () => void }).end();
}

export const handler = awslambda.streamifyResponse(
  async (event, responseStream) => {
    const origin = corsOrigin(event);

    if (event.httpMethod === "OPTIONS") {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Methods": "POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type,Authorization",
      };
      if (origin) headers["Access-Control-Allow-Origin"] = origin;
      const meta = JSON.stringify({ statusCode: 204, headers });
      responseStream.write(Buffer.concat([Buffer.from(meta, "utf8"), Buffer.alloc(8, 0)]));
      (responseStream as NodeJS.WritableStream & { end: () => void }).end();
      return;
    }

    try {
      await ensureRuntimeEnvFromSecrets();
    } catch (err) {
      console.error("[lambda/chat] secrets hydrate failed", err);
      await writeJsonError(responseStream, 500, { error: "Secrets hydrate failed" }, origin);
      return;
    }

    const { prepareChatTurn, iterateChatSseFrames } = await import(
      "../../src/lib/chat/run-chat-stream"
    );

    let userId: string;
    try {
      ({ userId } = await getIdentity(requestFromEvent(event)));
    } catch (err) {
      if (err instanceof IdentityError) {
        await writeJsonError(responseStream, err.status, { error: err.message }, origin);
        return;
      }
      await writeJsonError(responseStream, 500, { error: "Identity failure" }, origin);
      return;
    }

    let body: ChatRequestBody;
    try {
      body = JSON.parse(event.body || "{}") as ChatRequestBody;
    } catch {
      await writeJsonError(responseStream, 400, { error: "Invalid JSON body" }, origin);
      return;
    }

    const prepared = await prepareChatTurn(userId, body);
    if (!prepared.ok) {
      await writeJsonError(responseStream, prepared.status, prepared.body, origin);
      return;
    }

    responseStream.write(apigwStreamPreamble({ statusCode: 200, origin }));

    try {
      for await (const frame of iterateChatSseFrames(prepared.ctx)) {
        responseStream.write(frame);
      }
    } catch (err) {
      console.error("[lambda/chat]", err);
      responseStream.write(
        Buffer.from(`data: ${JSON.stringify({ error: "Stream failed" })}\n\n`, "utf8"),
      );
    }
    (responseStream as NodeJS.WritableStream & { end: () => void }).end();
  },
);
