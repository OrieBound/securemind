/** Encode one SSE `data:` frame (UTF-8). */
export function sseDataFrame(payload: unknown): Uint8Array {
  const encoder = new TextEncoder();
  if (payload === "[DONE]") {
    return encoder.encode("data: [DONE]\n\n");
  }
  return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
}

/** API Gateway Lambda streaming metadata delimiter (8 null bytes). */
export const APIGW_STREAM_DELIMITER = Buffer.alloc(8, 0);

export function apigwStreamPreamble(opts: {
  statusCode: number;
  headers?: Record<string, string>;
  origin?: string | null;
}): Buffer {
  const headers: Record<string, string> = {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    ...(opts.headers ?? {}),
  };
  if (opts.origin) {
    headers["Access-Control-Allow-Origin"] = opts.origin;
    headers["Access-Control-Allow-Credentials"] = "true";
  }
  const meta = JSON.stringify({
    statusCode: opts.statusCode,
    headers,
  });
  return Buffer.concat([Buffer.from(meta, "utf8"), APIGW_STREAM_DELIMITER]);
}
