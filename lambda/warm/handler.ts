/**
 * Lightweight warm Lambda — hit before chat to reduce cold-start latency.
 */

type ApiGwEvent = {
  httpMethod?: string;
  headers?: Record<string, string | undefined>;
};

type ApiGwResult = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
};

function corsHeaders(event: ApiGwEvent): Record<string, string> {
  const allowed = (process.env.ALLOWED_ORIGIN ?? "").split(",").map(s => s.trim()).filter(Boolean);
  const reqOrigin = event.headers?.origin ?? event.headers?.Origin ?? "";
  const origin =
    allowed.includes("*") ? (reqOrigin || "*")
    : reqOrigin && allowed.includes(reqOrigin) ? reqOrigin
    : allowed[0] ?? "";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
  };
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Credentials"] = "true";
  }
  return headers;
}

export async function handler(event: ApiGwEvent): Promise<ApiGwResult> {
  const headers = corsHeaders(event);
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ ok: true, warmedAt: Date.now() }),
  };
}
