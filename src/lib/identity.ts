/**
 * Server-derived request identity.
 *
 * Every route must obtain its `userId` here. Routes must never read a user or
 * tenant identifier from the request body, query string, or a client-controlled
 * header — doing so lets any caller act as any user simply by changing a
 * parameter.
 *
 * Modes (AUTH_MODE):
 *   local       — fixed single-user identity (default; current personal project)
 *   cognito     — verify Bearer JWT against Cognito JWKS; sub → userId
 *   jwt-hs256   — verify Bearer JWT with AUTH_DEV_JWT_SECRET (local/Floci demos)
 *
 * When Cognito/JWT verification fails or no token is present, behaviour depends
 * on AUTH_ALLOW_LOCAL_FALLBACK (default true for local DX). Set it to "false"
 * once a login UI exists and unauthenticated API access should be rejected.
 */

import { createRemoteJWKSet, jwtVerify } from "jose";

/** The only identity that exists before authentication is wired up. */
export const LOCAL_USER_ID = "local";

export type Identity = {
  userId: string;
  /** True when the userId came from a verified token. */
  authenticated: boolean;
};

export class IdentityError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.name = "IdentityError";
    this.status = status;
  }
}

type AuthMode = "local" | "cognito" | "jwt-hs256";

function authMode(): AuthMode {
  const raw = (process.env.AUTH_MODE ?? "local").toLowerCase();
  if (raw === "cognito" || raw === "jwt-hs256") return raw;
  return "local";
}

function allowLocalFallback(): boolean {
  const v = process.env.AUTH_ALLOW_LOCAL_FALLBACK;
  if (v === undefined || v === "") return true;
  return v === "true" || v === "1";
}

function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization") ?? req.headers.get("Authorization");
  if (!header) return null;
  const m = /^Bearer\s+(\S+)/i.exec(header);
  return m?.[1] ?? null;
}

function cognitoIssuer(): string | null {
  if (process.env.COGNITO_ISSUER) return process.env.COGNITO_ISSUER;
  const region = process.env.COGNITO_REGION || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
  const pool = process.env.COGNITO_USER_POOL_ID;
  if (region && pool) return `https://cognito-idp.${region}.amazonaws.com/${pool}`;
  return null;
}

function cognitoJwksUrl(issuer: string): string {
  return process.env.COGNITO_JWKS_URL ?? `${issuer}/.well-known/jwks.json`;
}

let _jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let _jwksUrl: string | null = null;

function jwksFor(url: string) {
  if (!_jwks || _jwksUrl !== url) {
    _jwks = createRemoteJWKSet(new URL(url));
    _jwksUrl = url;
  }
  return _jwks;
}

async function verifyCognito(token: string): Promise<string> {
  const issuer = cognitoIssuer();
  if (!issuer) {
    throw new IdentityError("Cognito is not configured (COGNITO_USER_POOL_ID / COGNITO_ISSUER).");
  }
  const { payload } = await jwtVerify(token, jwksFor(cognitoJwksUrl(issuer)), {
    issuer,
    ...(process.env.COGNITO_CLIENT_ID
      ? { audience: process.env.COGNITO_CLIENT_ID }
      : {}),
  });
  if (typeof payload.sub !== "string" || !payload.sub) {
    throw new IdentityError("Token missing subject.");
  }
  return payload.sub;
}

async function verifyHs256(token: string): Promise<string> {
  const secret = process.env.AUTH_DEV_JWT_SECRET;
  if (!secret) {
    throw new IdentityError("AUTH_DEV_JWT_SECRET is not set.");
  }
  const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
  if (typeof payload.sub !== "string" || !payload.sub) {
    throw new IdentityError("Token missing subject.");
  }
  return payload.sub;
}

/**
 * Resolve the caller's identity.
 *
 * Async because JWT verification is. Callers should not need to change shape
 * when switching AUTH_MODE.
 */
export async function getIdentity(req: Request): Promise<Identity> {
  const mode = authMode();

  if (mode === "local") {
    return { userId: LOCAL_USER_ID, authenticated: false };
  }

  const token = bearerToken(req);
  if (!token) {
    if (allowLocalFallback()) {
      return { userId: LOCAL_USER_ID, authenticated: false };
    }
    throw new IdentityError("Authentication required.");
  }

  try {
    const userId = mode === "cognito"
      ? await verifyCognito(token)
      : await verifyHs256(token);
    return { userId, authenticated: true };
  } catch (err) {
    if (err instanceof IdentityError) {
      if (allowLocalFallback()) {
        return { userId: LOCAL_USER_ID, authenticated: false };
      }
      throw err;
    }
    if (allowLocalFallback()) {
      return { userId: LOCAL_USER_ID, authenticated: false };
    }
    throw new IdentityError("Invalid or expired token.");
  }
}
