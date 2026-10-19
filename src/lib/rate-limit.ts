/**
 * Small in-memory fixed-window limiter for the public auth routes (login, code step,
 * forgot/confirm password, first-run claim).
 *
 * It is per server process: a Docker install has one process, so it is a real limit there.
 * On Amplify several instances each keep their own count, so it slows guessing rather than
 * capping it; Cognito's own lockout remains the backstop. Keys are hashed so no email or IP is
 * kept in plain form. Never use this for anything that must hold across instances.
 */

import { createHash } from "node:crypto";

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
const MAX_KEYS = 10_000;

function hashKey(parts: string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("base64url").slice(0, 22);
}

/** Test hook. */
export function resetRateLimits(): void {
  buckets.clear();
}

/** The caller's address as the proxy reports it; "unknown" when there is none. */
export function clientAddress(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim().slice(0, 64);
  return req.headers.get("x-real-ip")?.trim().slice(0, 64) || "unknown";
}

/**
 * Count one attempt. Returns the seconds to wait when over the limit, or 0 when allowed.
 */
export function hitRateLimit(scope: string, key: string, limit: number, windowMs: number): number {
  const now = Date.now();
  if (buckets.size > MAX_KEYS) {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    if (buckets.size > MAX_KEYS) buckets.clear();
  }
  const id = hashKey([scope, key]);
  const bucket = buckets.get(id);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(id, { count: 1, resetAt: now + windowMs });
    return 0;
  }
  bucket.count++;
  if (bucket.count > limit) return Math.ceil((bucket.resetAt - now) / 1000);
  return 0;
}

/**
 * Apply the auth limits for one route: per address, and per account when an email is given.
 * Returns a 429 Response to send back, or null to continue.
 */
export function authRateLimit(req: Request, scope: string, email?: string | null): Response | null {
  const perIp = hitRateLimit(`${scope}:ip`, clientAddress(req), 20, 60_000);
  const perAccount = email ? hitRateLimit(`${scope}:acct`, email.trim().toLowerCase(), 5, 60_000) : 0;
  const wait = Math.max(perIp, perAccount);
  if (!wait) return null;
  return Response.json(
    { error: "Too many attempts. Please wait a minute and try again." },
    { status: 429, headers: { "Retry-After": String(wait), "Cache-Control": "no-store" } },
  );
}
