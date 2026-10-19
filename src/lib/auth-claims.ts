/**
 * Token and auth-mode checks with no Node-only imports.
 *
 * The middleware runs on the edge runtime, so it must not import anything that reaches the
 * database or the AWS SDK. identity.ts re-exports everything here for server code.
 */

export class IdentityError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.name = "IdentityError";
    this.status = status;
  }
}

/** Production builds never fall back to the local Super Admin unless it is explicitly asked for. */
export function allowLocalFallback(): boolean {
  const v = process.env.AUTH_ALLOW_LOCAL_FALLBACK;
  if (v === undefined || v === "") return process.env.NODE_ENV !== "production";
  return v === "true" || v === "1";
}

/**
 * The fixed local identity is a development convenience. In a production build it needs
 * ALLOW_INSECURE_LOCAL_IDENTITY=true, so a missing AUTH_MODE cannot silently open every route.
 */
export function localIdentityAllowed(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  const v = process.env.ALLOW_INSECURE_LOCAL_IDENTITY;
  return v === "true" || v === "1";
}

/**
 * Floci JWTs often claim iss=http://floci:4566/... while host-side dev env uses
 * localhost:4566. Accept both so login cookies verify after npm run dev.
 */
export function cognitoIssuerCandidates(configured: string): string[] {
  const normalized = configured.replace(/\/$/, "");
  const out = new Set<string>([normalized]);
  try {
    const url = new URL(normalized);
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
      const alt = new URL(normalized);
      alt.hostname = "floci";
      out.add(alt.toString().replace(/\/$/, ""));
    } else if (url.hostname === "floci") {
      const alt = new URL(normalized);
      alt.hostname = "localhost";
      out.add(alt.toString().replace(/\/$/, ""));
    }
  } catch {
    /* malformed issuer */
  }
  return [...out];
}

/**
 * Claims every accepted Cognito token must carry. An ID token (token_use "id") or a token issued
 * to a different app client is refused. Real Cognito access tokens always have token_use "access"
 * and client_id, so those are required there; the Floci emulator is only held to the checks it
 * can satisfy (a present token_use must still be "access").
 */
export function assertAccessTokenClaims(
  payload: Record<string, unknown>,
  opts: { clientId?: string; issuer: string },
): void {
  const realCognito = /^https:\/\/cognito-idp\.[a-z0-9-]+\.amazonaws\.com\//.test(opts.issuer);
  const use = payload.token_use;
  if (use !== undefined && use !== "access") {
    throw new IdentityError("Not an access token.");
  }
  if (realCognito && use !== "access") {
    throw new IdentityError("Not an access token.");
  }
  if (opts.clientId) {
    if (payload.client_id !== opts.clientId) {
      throw new IdentityError("Token client_id mismatch.");
    }
  } else if (realCognito) {
    throw new IdentityError("COGNITO_CLIENT_ID is not set.", 503);
  }
}
