import { afterEach, describe, expect, it } from "vitest";
import {
  isHostedRuntime,
  isLambdaRuntime,
  resolveEmbedProvider,
  resolveStorageBackend,
  runtimeEdition,
  shouldSyncDocumentIngest,
} from "@/lib/runtime-env";
import { APIGW_STREAM_DELIMITER, apigwStreamPreamble, sseDataFrame } from "@/lib/chat/sse";
import { apiUrl, usesRemoteApi } from "@/lib/client/api-base";

describe("runtime-env", () => {
  const keys = [
    "AWS_LAMBDA_FUNCTION_NAME",
    "DOCUMENT_INGEST_SYNC",
    "EMBED_PROVIDER",
    "STORAGE_BACKEND",
    "AMPLIFY_HOSTING",
    "SECUREMIND_EDITION",
  ] as const;
  const prev: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  });

  function snap() {
    for (const k of keys) prev[k] = process.env[k];
  }

  it("detects Lambda and forces sync ingest", () => {
    snap();
    delete process.env.DOCUMENT_INGEST_SYNC;
    process.env.AWS_LAMBDA_FUNCTION_NAME = "chat";
    expect(isLambdaRuntime()).toBe(true);
    expect(shouldSyncDocumentIngest()).toBe(true);
    expect(resolveEmbedProvider()).toBe("bedrock");
  });

  it("keeps Ollama embeds and async ingest on local Next", () => {
    snap();
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    delete process.env.DOCUMENT_INGEST_SYNC;
    delete process.env.EMBED_PROVIDER;
    delete process.env.AMPLIFY_HOSTING;
    expect(isLambdaRuntime()).toBe(false);
    expect(shouldSyncDocumentIngest()).toBe(false);
    expect(resolveEmbedProvider()).toBe("ollama");
  });

  it("awaits indexing and uses Bedrock for explicit cloud editions without Lambda markers", () => {
    snap();
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    delete process.env.AMPLIFY_HOSTING;
    delete process.env.DOCUMENT_INGEST_SYNC;
    delete process.env.EMBED_PROVIDER;
    for (const edition of ["cloud", "hosted"]) {
      process.env.SECUREMIND_EDITION = edition;
      expect(shouldSyncDocumentIngest()).toBe(true);
      expect(resolveEmbedProvider()).toBe("bedrock");
    }
  });

  it("awaits indexing on Amplify even without a Lambda function marker", () => {
    snap();
    delete process.env.SECUREMIND_EDITION;
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    delete process.env.DOCUMENT_INGEST_SYNC;
    delete process.env.EMBED_PROVIDER;
    process.env.AMPLIFY_HOSTING = "1";
    expect(shouldSyncDocumentIngest()).toBe(true);
    expect(resolveEmbedProvider()).toBe("bedrock");
  });

  it("honors DOCUMENT_INGEST_SYNC and EMBED_PROVIDER overrides", () => {
    snap();
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    process.env.DOCUMENT_INGEST_SYNC = "true";
    process.env.EMBED_PROVIDER = "bedrock";
    expect(shouldSyncDocumentIngest()).toBe(true);
    expect(resolveEmbedProvider()).toBe("bedrock");
  });

  it("keeps Postgres as the default storage backend", () => {
    snap();
    delete process.env.STORAGE_BACKEND;
    expect(resolveStorageBackend()).toBe("postgres");
    process.env.STORAGE_BACKEND = "dynamodb";
    expect(resolveStorageBackend()).toBe("dynamodb");
  });

  it("treats Lambda and Amplify as hosted", () => {
    snap();
    delete process.env.SECUREMIND_EDITION;
    process.env.AWS_LAMBDA_FUNCTION_NAME = "api";
    expect(isHostedRuntime()).toBe(true);
    expect(runtimeEdition()).toBe("cloud");
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;
    process.env.AMPLIFY_HOSTING = "1";
    expect(isHostedRuntime()).toBe(true);
    process.env.SECUREMIND_EDITION = "local";
    expect(isHostedRuntime()).toBe(false);
  });
});

describe("chat sse helpers", () => {
  it("encodes SSE data frames", () => {
    const frame = new TextDecoder().decode(sseDataFrame({ delta: "hi" }));
    expect(frame).toBe('data: {"delta":"hi"}\n\n');
    expect(new TextDecoder().decode(sseDataFrame("[DONE]"))).toBe("data: [DONE]\n\n");
  });

  it("builds API Gateway streaming preamble with 8-null delimiter", () => {
    const buf = apigwStreamPreamble({
      statusCode: 200,
      origin: "http://localhost:3000",
    });
    const delimAt = buf.indexOf(APIGW_STREAM_DELIMITER);
    expect(delimAt).toBeGreaterThan(0);
    const meta = JSON.parse(buf.subarray(0, delimAt).toString("utf8")) as {
      statusCode: number;
      headers: Record<string, string>;
    };
    expect(meta.statusCode).toBe(200);
    expect(meta.headers["Content-Type"]).toBe("text/event-stream");
    expect(meta.headers["Access-Control-Allow-Origin"]).toBe("http://localhost:3000");
  });
});

describe("client api-base", () => {
  const key = "NEXT_PUBLIC_API_BASE_URL";
  let prev: string | undefined;

  afterEach(() => {
    if (prev === undefined) delete process.env[key];
    else process.env[key] = prev;
  });

  it("uses same-origin /api paths when unset", () => {
    prev = process.env[key];
    delete process.env[key];
    expect(usesRemoteApi()).toBe(false);
    expect(apiUrl("/api/chat")).toBe("/api/chat");
    expect(apiUrl("/api/warm")).toBe("/api/warm");
  });

  it("maps /api/* to gateway paths when base is set", () => {
    prev = process.env[key];
    process.env[key] = "https://example.execute-api.us-east-1.amazonaws.com/prod";
    expect(usesRemoteApi()).toBe(true);
    expect(apiUrl("/api/chat")).toBe(
      "https://example.execute-api.us-east-1.amazonaws.com/prod/chat",
    );
    expect(apiUrl("/api/warm")).toBe(
      "https://example.execute-api.us-east-1.amazonaws.com/prod/warm",
    );
  });
});
