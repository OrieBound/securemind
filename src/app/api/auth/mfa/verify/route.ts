export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { cognitoMfaCompleteSetup, mapMfaError } from "@/lib/cognito";
import { mfaJson, requireMfaSession } from "@/lib/auth-mfa-guard";

/** Step 2: the user types the code their app shows. If it matches, two-step verification turns on. */
export async function POST(req: NextRequest) {
  const session = await requireMfaSession(req);
  if (!session.ok) return session.response;

  let body: { code?: unknown };
  try {
    body = await req.json();
  } catch {
    return mfaJson({ error: "Invalid JSON body" }, 400);
  }
  const code = typeof body.code === "string" ? body.code.replace(/\s+/g, "") : "";
  if (!/^\d{6}$/.test(code)) {
    return mfaJson({ error: "Enter the 6-digit code from your authenticator app.", code: "invalid_code" }, 422);
  }

  try {
    await cognitoMfaCompleteSetup(session.accessToken, code);
    console.info("[auth/mfa] enabled");
    return mfaJson({ ok: true, enabled: true }, 200);
  } catch (err) {
    const mfa = mapMfaError(err);
    console.warn("[auth/mfa/verify]", mfa.code);
    return mfaJson({ error: mfa.message, code: mfa.code }, mfa.status);
  }
}
