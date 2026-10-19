import { authRateLimit } from "@/lib/rate-limit";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { cognitoConfigured, cognitoConfirmForgotPassword } from "@/lib/cognito";
import { clearAccessCookieHeader } from "@/lib/auth-cookies";
import { validateDirectoryPassword } from "@/lib/auth-password";

export async function POST(req: NextRequest) {
  const mode = (process.env.AUTH_MODE ?? "local").toLowerCase();
  if (mode !== "cognito" || !cognitoConfigured()) {
    return Response.json(
      { error: "Password reset is only available with Cognito authentication." },
      { status: 501 },
    );
  }

  let body: { email?: string; code?: string; newPassword?: string; confirmPassword?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase() ?? "";
  const limited = authRateLimit(req, "confirm-forgot", email);
  if (limited) return limited;
  const code = body.code?.trim() ?? "";
  const newPassword = body.newPassword ?? "";
  const confirmPassword = body.confirmPassword ?? "";

  if (!email || !code || !newPassword) {
    return Response.json({ error: "Email, code, and new password are required." }, { status: 422 });
  }
  if (newPassword !== confirmPassword) {
    return Response.json({ error: "Password confirmation does not match." }, { status: 422 });
  }
  const checked = validateDirectoryPassword(newPassword);
  if (!checked.ok) {
    return Response.json({ error: checked.error }, { status: 422 });
  }

  try {
    await cognitoConfirmForgotPassword(email, code, newPassword);
    console.info("[auth/confirm-forgot-password] success");
    return new Response(
      JSON.stringify({ ok: true, message: "Password reset. You can sign in with your new password." }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Set-Cookie": clearAccessCookieHeader(),
        },
      },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Reset failed";
    console.warn("[auth/confirm-forgot-password]", msg.slice(0, 160));
    return Response.json(
      { error: "Could not reset password. The code may be invalid or expired." },
      { status: 400 },
    );
  }
}
