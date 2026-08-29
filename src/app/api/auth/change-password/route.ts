export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { cognitoChangePassword, cognitoConfigured } from "@/lib/cognito";
import { readAccessTokenFromRequest, clearAccessCookieHeader } from "@/lib/auth-cookies";
import { getIdentity, identityErrorResponse } from "@/lib/identity";

export async function POST(req: NextRequest) {
  const mode = (process.env.AUTH_MODE ?? "local").toLowerCase();
  if (mode !== "cognito" || !cognitoConfigured()) {
    return Response.json(
      { error: "Password change is only available with Cognito authentication." },
      { status: 501 },
    );
  }

  try {
    await getIdentity(req);
  } catch (err) {
    const res = identityErrorResponse(err);
    if (res) return res;
    throw err;
  }

  const accessToken = readAccessTokenFromRequest(req);
  if (!accessToken) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }

  let body: { currentPassword?: string; newPassword?: string; confirmPassword?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const currentPassword = body.currentPassword ?? "";
  const newPassword = body.newPassword ?? "";
  const confirmPassword = body.confirmPassword ?? "";

  if (!currentPassword || !newPassword) {
    return Response.json({ error: "Current and new password are required." }, { status: 422 });
  }
  if (newPassword !== confirmPassword) {
    return Response.json({ error: "New password confirmation does not match." }, { status: 422 });
  }
  if (newPassword.length < 12) {
    return Response.json({ error: "New password must be at least 12 characters." }, { status: 422 });
  }

  try {
    await cognitoChangePassword(accessToken, currentPassword, newPassword);
    console.info("[auth/change-password] success");
    return new Response(JSON.stringify({ ok: true, message: "Password updated. Please sign in again." }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": clearAccessCookieHeader(),
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Password change failed";
    console.warn("[auth/change-password]", msg.slice(0, 160));
    return Response.json(
      { error: "Could not change password. Check your current password and policy requirements." },
      { status: 400 },
    );
  }
}
