export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { cognitoMfaAvailable, cognitoMfaEnabled, mapMfaError } from "@/lib/cognito";
import { mfaJson, requireMfaSession } from "@/lib/auth-mfa-guard";
import { isAdminRole } from "@/lib/roles";

/** Is two-step verification on for the signed-in user, and should we nudge them to turn it on? */
export async function GET(req: NextRequest) {
  // Not an error when unavailable: the page shows an explanation instead of the controls.
  if (!cognitoMfaAvailable()) {
    return mfaJson({ available: false, enabled: false, recommended: false }, 200);
  }

  const session = await requireMfaSession(req);
  if (!session.ok) return session.response;

  try {
    const enabled = await cognitoMfaEnabled(session.accessToken);
    return mfaJson(
      {
        available: true,
        enabled,
        // Whoever can manage people, keys and settings should not rely on a password alone.
        recommended: !enabled && isAdminRole(session.identity.role),
      },
      200,
    );
  } catch (err) {
    const mfa = mapMfaError(err);
    return mfaJson({ error: mfa.message, code: mfa.code }, mfa.status);
  }
}
