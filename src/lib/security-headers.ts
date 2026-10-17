/**
 * HTTP security headers for the UI (Next.js) and the API (Lambda / API Gateway).
 *
 * Pure and dependency-free so next.config.ts, the Lambda handlers and tests can all import
 * it (no path aliases here: next.config.ts cannot resolve "@/").
 *
 * What the Content-Security-Policy does and does not do:
 * - It limits where the page may load code, images and data from, and who may frame it.
 *   The browser only talks to its own origin and to the chat API origin, because every
 *   model vendor is called from the server. So the policy is tight on connections.
 * - `script-src` still allows inline scripts. Next.js writes inline hydration scripts into
 *   every page, and the theme bootstrap is inline. Blocking them needs a per-request nonce
 *   from middleware, which is a larger change. Treat the CSP as defence in depth against
 *   injected resources and clickjacking, not as a complete XSS barrier.
 */

export type HeaderPair = { key: string; value: string };

export type SecurityHeaderOptions = {
  /** Origins the browser may call besides itself, e.g. the chat API (https://x.execute-api...). */
  apiOrigins?: string[];
  /** Development adds what Next's dev server needs (eval, websocket). Never true in production. */
  dev?: boolean;
  /** Cloud edition on HTTPS: adds HSTS and upgrade-insecure-requests. Off for http://localhost. */
  https?: boolean;
};

/** The origin of a URL, or null if it is not a usable http(s) URL. */
export function originOf(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const u = new URL(value.trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u.origin : null;
  } catch {
    return null;
  }
}

/** Chat API origin(s) from the environment (NEXT_PUBLIC_API_BASE_URL, comma separated allowed). */
export function apiOriginsFromEnv(env: Record<string, string | undefined> = process.env): string[] {
  const raw = env.NEXT_PUBLIC_API_BASE_URL ?? "";
  const origins = raw
    .split(",")
    .map(originOf)
    .filter((o): o is string => Boolean(o));
  return [...new Set(origins)];
}

export function buildCsp(opts: SecurityHeaderOptions = {}): string {
  const apiOrigins = (opts.apiOrigins ?? []).map(originOf).filter((o): o is string => Boolean(o));
  const scriptSrc = ["'self'", "'unsafe-inline'", ...(opts.dev ? ["'unsafe-eval'"] : [])];
  const connectSrc = ["'self'", ...apiOrigins, ...(opts.dev ? ["ws:", "wss:"] : [])];

  const directives: string[] = [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    `script-src ${scriptSrc.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' blob:",
    `connect-src ${connectSrc.join(" ")}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ];
  if (opts.https) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}

/** Microphone stays available to this origin for voice input; everything else is off. */
export const PERMISSIONS_POLICY =
  "camera=(), microphone=(self), geolocation=(), payment=(), usb=(), bluetooth=(), interest-cohort=()";

/** Headers for every HTML and API response served by Next. */
export function securityHeaders(opts: SecurityHeaderOptions = {}): HeaderPair[] {
  const headers: HeaderPair[] = [
    { key: "Content-Security-Policy", value: buildCsp(opts) },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: PERMISSIONS_POLICY },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  ];
  if (opts.https) {
    headers.push({ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" });
  }
  return headers;
}

/**
 * Headers for responses from the chat and warm Lambdas. They return JSON or an event stream,
 * never a page, so only the content-type, referrer and transport rules apply.
 */
export const API_SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Cross-Origin-Resource-Policy": "same-site",
};

/** Options for the running Next server, taken from the environment. */
export function securityOptionsFromEnv(env: Record<string, string | undefined> = process.env): SecurityHeaderOptions {
  return {
    apiOrigins: apiOriginsFromEnv(env),
    dev: env.NODE_ENV !== "production",
    https: env.SECUREMIND_EDITION === "cloud",
  };
}
