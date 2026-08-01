import { NextResponse, type NextRequest } from "next/server";
import { createRemoteJWKSet, jwtVerify } from "jose";

/**
 * When AUTH_MODE is cognito (or jwt-hs256), require a valid access token for
 * /api/* except /api/auth/*. Login UI talks to /api/auth/* without a cookie.
 *
 * Verification mirrors getIdentity() so forged cookies never reach handlers.
 */

function issuer(): string | null {
  if (process.env.COGNITO_ISSUER) return process.env.COGNITO_ISSUER;
  const region = process.env.COGNITO_REGION || process.env.AWS_REGION || "us-east-1";
  const pool = process.env.COGNITO_USER_POOL_ID;
  if (pool) return `https://cognito-idp.${region}.amazonaws.com/${pool}`;
  return null;
}

function readToken(req: NextRequest): string | null {
  const auth = req.headers.get("authorization");
  if (auth) {
    const m = /^Bearer\s+(\S+)/i.exec(auth);
    if (m?.[1]) return m[1];
  }
  return req.cookies.get("sm_access_token")?.value ?? null;
}

let _jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let _jwksUrl: string | null = null;

function jwks(url: string) {
  if (!_jwks || _jwksUrl !== url) {
    _jwks = createRemoteJWKSet(new URL(url));
    _jwksUrl = url;
  }
  return _jwks;
}

export async function middleware(req: NextRequest) {
  const mode = (process.env.AUTH_MODE ?? "local").toLowerCase();
  if (mode === "local") return NextResponse.next();

  const path = req.nextUrl.pathname;
  if (!path.startsWith("/api/")) return NextResponse.next();
  if (path.startsWith("/api/auth")) return NextResponse.next();

  const fallback = process.env.AUTH_ALLOW_LOCAL_FALLBACK;
  const allowFallback = fallback === undefined || fallback === "" || fallback === "true" || fallback === "1";

  const token = readToken(req);
  if (!token) {
    if (allowFallback) return NextResponse.next();
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  try {
    if (mode === "cognito") {
      const iss = issuer();
      if (!iss) {
        return NextResponse.json({ error: "Cognito is not configured." }, { status: 503 });
      }
      const jwksUrl = process.env.COGNITO_JWKS_URL ?? `${iss.replace(/\/$/, "")}/.well-known/jwks.json`;
      await jwtVerify(token, jwks(jwksUrl), { issuer: iss });
    } else if (mode === "jwt-hs256") {
      const secret = process.env.AUTH_DEV_JWT_SECRET;
      if (!secret) {
        return NextResponse.json({ error: "AUTH_DEV_JWT_SECRET is not set." }, { status: 503 });
      }
      await jwtVerify(token, new TextEncoder().encode(secret));
    }
    return NextResponse.next();
  } catch {
    if (allowFallback) return NextResponse.next();
    return NextResponse.json({ error: "Invalid or expired token." }, { status: 401 });
  }
}

export const config = {
  matcher: ["/api/:path*"],
};
