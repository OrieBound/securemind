export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { cognitoMfaBeginSetup, cognitoMfaEnabled, mapMfaError } from "@/lib/cognito";
import { mfaJson, requireMfaSession } from "@/lib/auth-mfa-guard";
import { formatSecretForDisplay, otpauthUri } from "@/lib/totp";
import { PRODUCT_NAME } from "@/lib/branding";

/**
 * Step 1 of turning two-step verification on: ask Cognito for a new secret for this user and
 * return it as an otpauth link (for the QR code) and as text (to type by hand). The secret is
 * not active until /api/auth/mfa/verify accepts a code made from it.
 */
export async function POST(req: NextRequest) {
  const session = await requireMfaSession(req);
  if (!session.ok) return session.response;

  try {
    if (await cognitoMfaEnabled(session.accessToken)) {
      return mfaJson(
        { error: "Two-step verification is already on. Turn it off first to set up a new device.", code: "already_enabled" },
        409,
      );
    }
    const { secret } = await cognitoMfaBeginSetup(session.accessToken);
    return mfaJson(
      {
        otpauthUri: otpauthUri({
          secret,
          account: session.identity.email ?? "account",
          issuer: PRODUCT_NAME,
        }),
        secret: formatSecretForDisplay(secret),
      },
      200,
    );
  } catch (err) {
    const mfa = mapMfaError(err);
    return mfaJson({ error: mfa.message, code: mfa.code }, mfa.status);
  }
}
