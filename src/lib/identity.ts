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
import {
  allowLocalFallback,
  assertAccessTokenClaims,
  cognitoIssuerCandidates,
  IdentityError,
  localIdentityAllowed,
} from "@/lib/auth-claims";

export { roleFromGroups };
export {
  allowLocalFallback,
  assertAccessTokenClaims,
  cognitoIssuerCandidates,
  IdentityError,
  localIdentityAllowed,
};

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

type AuthMode = "local" | "cognito" | "jwt-hs256";

function authMode(): AuthMode {
  const raw = (process.env.AUTH_MODE ?? "local").toLowerCase();
  if (raw === "cognito" || raw === "jwt-hs256") return raw;
  return "local";
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
  assertAccessTokenClaims(payload as Record<string, unknown>, {
    clientId: process.env.COGNITO_CLIENT_ID,
    issuer,
  });
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

  let verified: { userId: string; email?: string; groups: string[] };
  try {
    verified = mode === "cognito" ? await verifyCognito(token) : await verifyHs256(token);
  } catch (err) {
    if (allowLocalFallback()) {
      return localOwnerIdentity();
    }
    if (err instanceof IdentityError) throw err;
    throw new IdentityError("Invalid or expired token.");
  }

  // Outside the try on purpose: a suspended account must never fall back to the local identity.
  if (mode === "cognito") await assertAccountActive(verified.userId);
  return {
    userId: verified.userId,
    authenticated: true,
    email: verified.email,
    groups: verified.groups,
    role: roleFromGroups(verified.groups),
  };
}

const STATUS_TTL_MS = 30_000;
const statusCache = new Map<string, { blocked: boolean; at: number }>();

/**
 * A suspended or deleted account keeps a valid access token until it expires. Look the profile
 * up (cached for 30 seconds) and refuse those accounts. If the lookup itself fails the token
 * decision stands, so a database blip does not lock everyone out.
 */
async function assertAccountActive(userId: string): Promise<void> {
  const hit = statusCache.get(userId);
  if (hit && Date.now() - hit.at < STATUS_TTL_MS) {
    if (hit.blocked) throw new IdentityError("This account is not active.", 403);
    return;
  }
  let blocked = false;
  try {
    const { getUserProfile } = await import("@/lib/user-profile");
    const profile = await getUserProfile(userId);
    blocked = profile?.status === "suspended" || profile?.status === "deleted";
  } catch {
    return;
  }
  statusCache.set(userId, { blocked, at: Date.now() });
  if (blocked) throw new IdentityError("This account is not active.", 403);
}

/** Map IdentityError to a JSON Response, or null if unrelated. */
export function identityErrorResponse(err: unknown): Response | null {
  if (err instanceof IdentityError) {
    return Response.json({ error: err.message }, { status: err.status });
  }
  return null;
}
