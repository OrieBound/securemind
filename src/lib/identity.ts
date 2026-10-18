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
 *   cognito     — verify Bearer/cookie JWT against Cognito JWKS; sub → userId
 *   jwt-hs256   — verify Bearer/cookie JWT with AUTH_DEV_JWT_SECRET (local demos)
 *
 * When Cognito/JWT verification fails or no token is present, behaviour depends
 * on AUTH_ALLOW_LOCAL_FALLBACK (default true for local DX). Set it to "false"
 * for the Floci Cognito experiment so unauthenticated API calls return 401.
 */

import { createRemoteJWKSet, jwtVerify } from "jose";
import { readAccessTokenFromRequest } from "@/lib/auth-cookies";
import { roleFromGroups, type AppRole } from "@/lib/roles";

export { roleFromGroups };

/** The only identity that exists before authentication is wired up. */
export const LOCAL_USER_ID = "local";

export type Identity = {
  userId: string;
  /** True when the userId came from a verified token. */
  authenticated: boolean;
  email?: string;
  /** Super Admin / Admin can manage providers & users; Member is ordinary. */
  role: AppRole;
  /** Cognito group names when present. */
  groups: string[];
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

function cognitoIssuer(): string | null {
  if (process.env.COGNITO_ISSUER) return process.env.COGNITO_ISSUER;
  const region = process.env.COGNITO_REGION || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
  const pool = process.env.COGNITO_USER_POOL_ID;
  if (region && pool) return `https://cognito-idp.${region}.amazonaws.com/${pool}`;
  return null;
}

function cognitoJwksUrl(issuer: string): string {
  return process.env.COGNITO_JWKS_URL ?? `${issuer.replace(/\/$/, "")}/.well-known/jwks.json`;
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

let _jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let _jwksUrl: string | null = null;

function jwksFor(url: string) {
  if (!_jwks || _jwksUrl !== url) {
    _jwks = createRemoteJWKSet(new URL(url));
    _jwksUrl = url;
  }
  return _jwks;
}

function groupsFromPayload(payload: Record<string, unknown>): string[] {
  const raw =
    payload["cognito:groups"] ??
    payload.groups ??
    payload["custom:groups"];
  if (Array.isArray(raw)) {
    return raw.filter((g): g is string => typeof g === "string");
  }
  if (typeof raw === "string" && raw.trim()) {
    return raw.split(",").map(s => s.trim()).filter(Boolean);
  }
  return [];
}

function localOwnerIdentity(): Identity {
  return {
    userId: LOCAL_USER_ID,
    authenticated: false,
    role: "super_admin",
    groups: ["Owner"],
  };
}

async function verifyCognito(token: string): Promise<{
  userId: string;
  email?: string;
  groups: string[];
}> {
  const issuer = cognitoIssuer();
  if (!issuer) {
    throw new IdentityError("Cognito is not configured (COGNITO_USER_POOL_ID / COGNITO_ISSUER).");
  }
  const { payload } = await jwtVerify(token, jwksFor(cognitoJwksUrl(issuer)), {
    issuer: cognitoIssuerCandidates(issuer),
  });
  if (typeof payload.sub !== "string" || !payload.sub) {
    throw new IdentityError("Token missing subject.");
  }
  const clientId = process.env.COGNITO_CLIENT_ID;
  if (clientId && typeof payload.client_id === "string" && payload.client_id !== clientId) {
    throw new IdentityError("Token client_id mismatch.");
  }
  const email = typeof payload.email === "string" ? payload.email : undefined;
  const groups = groupsFromPayload(payload as Record<string, unknown>);
  return { userId: payload.sub, email, groups };
}

async function verifyHs256(token: string): Promise<{
  userId: string;
  email?: string;
  groups: string[];
}> {
  const secret = process.env.AUTH_DEV_JWT_SECRET;
  if (!secret) {
    throw new IdentityError("AUTH_DEV_JWT_SECRET is not set.");
  }
  const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
  if (typeof payload.sub !== "string" || !payload.sub) {
    throw new IdentityError("Token missing subject.");
  }
  const email = typeof payload.email === "string" ? payload.email : undefined;
  const groups = groupsFromPayload(payload as Record<string, unknown>);
  return { userId: payload.sub, email, groups };
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
    if (!localIdentityAllowed()) {
      throw new IdentityError(
        "Authentication is not configured. Set AUTH_MODE=cognito, or ALLOW_INSECURE_LOCAL_IDENTITY=true for a single-user machine.",
        503,
      );
    }
    return localOwnerIdentity();
  }

  const token = readAccessTokenFromRequest(req);
  if (!token) {
    if (allowLocalFallback()) {
      return localOwnerIdentity();
    }
    throw new IdentityError("Authentication required.");
  }

  try {
    const verified = mode === "cognito"
      ? await verifyCognito(token)
      : await verifyHs256(token);
    return {
      userId: verified.userId,
      authenticated: true,
      email: verified.email,
      groups: verified.groups,
      role: roleFromGroups(verified.groups),
    };
  } catch (err) {
    if (err instanceof IdentityError) {
      if (allowLocalFallback()) {
        return localOwnerIdentity();
      }
      throw err;
    }
    if (allowLocalFallback()) {
      return localOwnerIdentity();
    }
    throw new IdentityError("Invalid or expired token.");
  }
}

/** Map IdentityError to a JSON Response, or null if unrelated. */
export function identityErrorResponse(err: unknown): Response | null {
  if (err instanceof IdentityError) {
    return Response.json({ error: err.message }, { status: err.status });
  }
  return null;
}
