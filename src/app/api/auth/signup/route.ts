import { NextRequest } from "next/server";
import { cognitoSignUp, cognitoLogin, cognitoConfigured } from "@/lib/cognito";
import { accessCookieHeader } from "@/lib/auth-cookies";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!cognitoConfigured()) {
    return Response.json(
      { error: "Cognito is not configured. Run node scripts/floci-cognito-setup.mjs and set .env.local." },
      { status: 503 },
    );
  }

  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase() ?? "";
  const password = body.password ?? "";
  if (!email || !password) {
    return Response.json({ error: "Email and password are required." }, { status: 422 });
  }
  if (password.length < 8) {
    return Response.json({ error: "Password must be at least 8 characters." }, { status: 422 });
  }

  try {
    const { userConfirmed } = await cognitoSignUp(email, password);
    // Floci usually auto-confirms; try login immediately when confirmed.
    if (userConfirmed) {
      const tokens = await cognitoLogin(email, password);
      return new Response(
        JSON.stringify({ ok: true, confirmed: true, expiresIn: tokens.expiresIn }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Set-Cookie": accessCookieHeader(tokens.accessToken, tokens.expiresIn),
          },
        },
      );
    }
    return Response.json({
      ok: true,
      confirmed: false,
      message: "Check your email for a confirmation code (real Cognito). Floci usually auto-confirms.",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Signup failed";
    if (/UsernameExistsException|already exists/i.test(msg)) {
      return Response.json({ error: "An account with that email already exists." }, { status: 409 });
    }
    console.warn("[auth/signup]", msg.slice(0, 160));
    return Response.json({ error: "Could not create account." }, { status: 400 });
  }
}
