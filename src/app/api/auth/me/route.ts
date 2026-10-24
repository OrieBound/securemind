import { NextRequest } from "next/server";
import { getIdentity, identityErrorResponse } from "@/lib/identity";
import { readAccessTokenFromRequest } from "@/lib/auth-cookies";
import { getUserProfile } from "@/lib/user-profile";

export const runtime = "nodejs";

/**
 * Returns the current session. Always 200 when AUTH_MODE=local.
 * Under Cognito with fallback disabled, unauthenticated callers get 401.
 *
 * When authenticated, also returns the access token so the browser can call
 * the cross-origin chat Lambda (cookie is HttpOnly on Amplify and is not sent
 * to API Gateway).
 */
export async function GET(req: NextRequest) {
  try {
    const id = await getIdentity(req);
    const accessToken = id.authenticated ? readAccessTokenFromRequest(req) : null;
    // A Cognito access token carries no email, so take it from the account's own profile. Without
    // this the header shows "Local user" and per-account browser settings share one name.
    let email = id.email ?? null;
    if (!email && id.authenticated && id.userId && id.userId !== "local") {
      try {
        email = (await getUserProfile(id.userId))?.email ?? null;
      } catch {
        /* the label falls back; sign-in is unaffected */
      }
    }
    return Response.json({
      userId: id.userId,
      authenticated: id.authenticated,
      email,
      mode: process.env.AUTH_MODE ?? "local",
      role: id.role,
      groups: id.groups,
      ...(accessToken ? { accessToken } : {}),
    });
  } catch (err) {
    const res = identityErrorResponse(err);
    if (res) return res;
    throw err;
  }
}
