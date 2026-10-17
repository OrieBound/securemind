/**
 * Finishing a sign-in, shared by the password route and the two-step (code) route:
 * look up the user, make sure their profile exists, and set the session cookie.
 */

import { createRemoteJWKSet, jwtVerify } from "jose";
import { accessCookieHeader } from "@/lib/auth-cookies";
import type { AuthTokens } from "@/lib/cognito";
import { cognitoIssuerCandidates } from "@/lib/identity";
import { ensureUserProfile } from "@/lib/user-profile";

async function subFromAccessToken(accessToken: string): Promise<string | null> {
  try {
    const region = process.env.COGNITO_REGION || process.env.AWS_REGION || "us-east-1";
    const pool = process.env.COGNITO_USER_POOL_ID;
    const iss =
      process.env.COGNITO_ISSUER ||
      (pool ? `https://cognito-idp.${region}.amazonaws.com/${pool}` : null);
    if (!iss) return null;
    const jwksUrl = process.env.COGNITO_JWKS_URL ?? `${iss.replace(/\/$/, "")}/.well-known/jwks.json`;
    const { payload } = await jwtVerify(accessToken, createRemoteJWKSet(new URL(jwksUrl)), {
      issuer: cognitoIssuerCandidates(iss),
    });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

/** The 200 response that signs a user in: session cookie, plus the token for the remote API. */
export async function completeLogin(email: string, tokens: AuthTokens): Promise<Response> {
  const sub = await subFromAccessToken(tokens.accessToken);
  if (sub) {
    try {
      await ensureUserProfile({ userId: sub, email, touchSignIn: true });
    } catch (err) {
      console.warn("[auth/login] profile upsert", err instanceof Error ? err.message : err);
    }
  }
  // Cookie for same-origin use; accessToken in the body for the API Gateway Bearer calls.
  return new Response(
    JSON.stringify({
      ok: true,
      expiresIn: tokens.expiresIn,
      accessToken: tokens.accessToken,
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "Set-Cookie": accessCookieHeader(tokens.accessToken, tokens.expiresIn),
      },
    },
  );
}
