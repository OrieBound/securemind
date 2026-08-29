import { NextRequest } from "next/server";
import { getIdentity, identityErrorResponse } from "@/lib/identity";

export const runtime = "nodejs";

/**
 * Returns the current session. Always 200 when AUTH_MODE=local.
 * Under Cognito with fallback disabled, unauthenticated callers get 401.
 */
export async function GET(req: NextRequest) {
  try {
    const id = await getIdentity(req);
    return Response.json({
      userId: id.userId,
      authenticated: id.authenticated,
      email: id.email ?? null,
      mode: process.env.AUTH_MODE ?? "local",
      role: id.role,
      groups: id.groups,
    });
  } catch (err) {
    const res = identityErrorResponse(err);
    if (res) return res;
    throw err;
  }
}
