/**
 * Guard for the signed-in two-step verification routes (status, set up, verify, turn off).
 *
 * It answers three questions before any Cognito call is made: is this a Cognito install
 * that can do authenticator codes, is the caller signed in, and do we hold their access token.
 */

import { cognitoMfaAvailable } from "@/lib/cognito";
import { readAccessTokenFromRequest } from "@/lib/auth-cookies";
import { getIdentity, identityErrorResponse, type Identity } from "@/lib/identity";

export type MfaSession =
  | { ok: true; identity: Identity; accessToken: string }
  | { ok: false; response: Response };

function json(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function requireMfaSession(req: Request): Promise<MfaSession> {
  const mode = (process.env.AUTH_MODE ?? "local").toLowerCase();
  if (mode !== "cognito" || !cognitoMfaAvailable()) {
    return {
      ok: false,
      response: json(
        {
          error:
            "Two-step verification needs real Amazon Cognito. The local sign-in used by Docker does not support it.",
          code: "unavailable",
        },
        501,
      ),
    };
  }

  let identity: Identity;
  try {
    identity = await getIdentity(req);
  } catch (err) {
    const res = identityErrorResponse(err);
    if (res) return { ok: false, response: res };
    throw err;
  }
  if (!identity.authenticated) {
    return { ok: false, response: json({ error: "Authentication required." }, 401) };
  }

  const accessToken = readAccessTokenFromRequest(req);
  if (!accessToken) {
    return { ok: false, response: json({ error: "Authentication required." }, 401) };
  }
  return { ok: true, identity, accessToken };
}

export { json as mfaJson };
