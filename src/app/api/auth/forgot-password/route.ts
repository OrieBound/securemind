export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { cognitoConfigured, cognitoForgotPassword } from "@/lib/cognito";

const GENERIC =
  "If an account exists for that email, a reset code has been sent. Check your inbox.";

/**
 * Enumeration-safe: always returns the same message whether or not the user exists.
 */
export async function POST(req: NextRequest) {
  const mode = (process.env.AUTH_MODE ?? "local").toLowerCase();
  if (mode !== "cognito" || !cognitoConfigured()) {
    return Response.json(
      { error: "Password reset is only available with Cognito authentication." },
      { status: 501 },
    );
  }

  let body: { email?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase() ?? "";
  if (!email) {
    return Response.json({ error: "Email is required." }, { status: 422 });
  }

  try {
    await cognitoForgotPassword(email);
  } catch (err) {
    // Swallow not-found and similar — do not leak account existence.
    const msg = err instanceof Error ? err.message : "";
    console.warn("[auth/forgot-password]", msg.slice(0, 120));
  }

  return Response.json({ ok: true, message: GENERIC });
}
