export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getIdentity, identityErrorResponse } from "@/lib/identity";
import { ensureUserProfile } from "@/lib/user-profile";
import { cognitoConfigured } from "@/lib/cognito";
import { readAccessTokenFromRequest } from "@/lib/auth-cookies";
import { directoryPasswordPolicy } from "@/lib/auth-password";

export async function GET(req: NextRequest) {
  try {
    const identity = await getIdentity(req);
    const mode = (process.env.AUTH_MODE ?? "local").toLowerCase();
    const profile = await ensureUserProfile({
      userId: identity.userId,
      email: identity.email ?? null,
    });

    const passwordManagedByCognito =
      mode === "cognito" && cognitoConfigured() && identity.authenticated;
    const hasAccessToken = Boolean(readAccessTokenFromRequest(req));

    return Response.json({
      authMode: mode,
      role: identity.role,
      groups: identity.groups,
      authenticated: identity.authenticated,
      email: identity.email ?? profile.email,
      emailVerified: mode === "cognito" ? true : null, // Cognito login implies confirmed for our flows
      status: profile.status,
      lastSignInAt: profile.lastSignInAt,
      accountCreatedAt: profile.createdAt,
      passwordChangeAvailable: passwordManagedByCognito && hasAccessToken,
      passwordPolicy: directoryPasswordPolicy(),
      passwordManagedExternally: false,
      mfaStatus: "unavailable" as const,
      sessions: "unavailable" as const,
      note:
        mode === "local"
          ? "Local auth mode has no Cognito password. Profile preferences still apply to this device user."
          : passwordManagedByCognito
            ? "Password is managed by Cognito. Changing it signs you out of this session."
            : "Password management is unavailable for this session.",
    });
  } catch (err) {
    const res = identityErrorResponse(err);
    if (res) return res;
    throw err;
  }
}
