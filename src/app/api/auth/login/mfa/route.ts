import { authRateLimit } from "@/lib/rate-limit";
import { NextRequest } from "next/server";
import { cognitoMfaAvailable, cognitoRespondToMfa, mapMfaError } from "@/lib/cognito";
import { completeLogin } from "@/lib/auth-login";

export const runtime = "nodejs";

/**
 * Second step of sign-in for accounts with two-step verification on. Public by design (no
 * session exists yet), so it validates its own input and trusts nothing: the session string is
 * only useful together with a valid code, and Cognito limits wrong attempts.
 */
export async function POST(req: NextRequest) {
  if (!cognitoMfaAvailable()) {
    return Response.json({ error: "Two-step verification is not available here." }, { status: 501 });
  }

  let body: { email?: unknown; session?: unknown; code?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const limited = authRateLimit(req, "login-mfa", email);
  if (limited) return limited;
  const session = typeof body.session === "string" ? body.session : "";
  const code = typeof body.code === "string" ? body.code.replace(/\s+/g, "") : "";

  if (!email || session.length < 20 || session.length > 8192) {
    return Response.json(
      { error: "That sign-in attempt expired. Enter your email and password again.", restart: true },
      { status: 401 },
    );
  }
  if (!/^\d{6}$/.test(code)) {
    return Response.json({ error: "Enter the 6-digit code from your authenticator app." }, { status: 422 });
  }

  try {
    const tokens = await cognitoRespondToMfa({ email, session, code });
    return await completeLogin(email, tokens);
  } catch (err) {
    const mfa = mapMfaError(err);
    console.warn("[auth/login/mfa]", mfa.code);
    return Response.json(
      { error: mfa.message, code: mfa.code, restart: mfa.code === "session_expired" },
      { status: mfa.status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
