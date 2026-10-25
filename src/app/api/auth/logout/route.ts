import { clearAccessCookieHeader, readAccessTokenFromRequest } from "@/lib/auth-cookies";
import { cognitoConfigured, cognitoGlobalSignOut } from "@/lib/cognito";

export const runtime = "nodejs";

export async function POST(req: Request) {
  // Sign out at Cognito too, which ends the refresh session. An access token that was already
  // issued stays valid until it expires (up to an hour), because the app checks its signature
  // locally. Best effort: the cookie is cleared even when Cognito cannot be reached.
  const token = readAccessTokenFromRequest(req);
  if (token && cognitoConfigured()) {
    try {
      await cognitoGlobalSignOut(token);
    } catch (err) {
      console.warn("[auth/logout] global sign-out failed", err instanceof Error ? err.name : "error");
    }
  }
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": clearAccessCookieHeader(),
    },
  });
}
