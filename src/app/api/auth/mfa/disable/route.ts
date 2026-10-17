export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { cognitoCheckPassword, cognitoMfaDisable, mapMfaError } from "@/lib/cognito";
import { mfaJson, requireMfaSession } from "@/lib/auth-mfa-guard";

/**
 * Turn two-step verification off. Needs the account password again, so a stolen session
 * cookie alone cannot remove the second step.
 */
export async function POST(req: NextRequest) {
  const session = await requireMfaSession(req);
  if (!session.ok) return session.response;

  const email = session.identity.email?.trim().toLowerCase();
  if (!email) {
    return mfaJson({ error: "This session has no email address to check the password against." }, 400);
  }

  let body: { password?: unknown };
  try {
    body = await req.json();
  } catch {
    return mfaJson({ error: "Invalid JSON body" }, 400);
  }
  const password = typeof body.password === "string" ? body.password : "";
  if (!password) {
    return mfaJson({ error: "Enter your password to turn this off.", code: "wrong_password" }, 422);
  }

  try {
    if (!(await cognitoCheckPassword(email, password))) {
      return mfaJson({ error: "That password is not correct.", code: "wrong_password" }, 403);
    }
    await cognitoMfaDisable(session.accessToken);
    console.info("[auth/mfa] disabled");
    return mfaJson({ ok: true, enabled: false }, 200);
  } catch (err) {
    const mfa = mapMfaError(err);
    console.warn("[auth/mfa/disable]", mfa.code);
    return mfaJson({ error: mfa.message, code: mfa.code }, mfa.status);
  }
}
