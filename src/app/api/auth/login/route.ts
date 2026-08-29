import { NextRequest } from "next/server";
import { cognitoLogin, cognitoConfigured } from "@/lib/cognito";
import { accessCookieHeader } from "@/lib/auth-cookies";
import { cognitoIssuerCandidates } from "@/lib/identity";
import { ensureUserProfile } from "@/lib/user-profile";
import { createRemoteJWKSet, jwtVerify } from "jose";

export const runtime = "nodejs";

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

export async function POST(req: NextRequest) {
  if (!cognitoConfigured()) {
    return Response.json(
      { error: "Cognito is not configured. Run node scripts/floci-cognito-setup.mjs and set .env.local." },
      { status: 503 },
    );
  }

  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase() ?? "";
  const password = body.password ?? "";
  if (!email || !password) {
    return Response.json({ error: "Email and password are required." }, { status: 422 });
  }

  try {
    const tokens = await cognitoLogin(email, password);
    const sub = await subFromAccessToken(tokens.accessToken);
    if (sub) {
      try {
        await ensureUserProfile({ userId: sub, email, touchSignIn: true });
      } catch (err) {
        console.warn("[auth/login] profile upsert", err instanceof Error ? err.message : err);
      }
    }
    // Cookie for same-origin localhost; accessToken in body for remote API Gateway Bearer use.
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
          "Set-Cookie": accessCookieHeader(tokens.accessToken, tokens.expiresIn),
        },
      },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Login failed";
    console.warn("[auth/login]", msg.slice(0, 160));
    return Response.json({ error: "Invalid email or password." }, { status: 401 });
  }
}
