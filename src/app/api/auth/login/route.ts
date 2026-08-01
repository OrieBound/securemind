import { NextRequest } from "next/server";
import { cognitoLogin, cognitoConfigured } from "@/lib/cognito";
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

  try {
    const tokens = await cognitoLogin(email, password);
    return new Response(
      JSON.stringify({ ok: true, expiresIn: tokens.expiresIn }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Set-Cookie": accessCookieHeader(tokens.accessToken, tokens.expiresIn),
        },
      },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Login failed";
    console.warn("[auth/login]", msg.slice(0, 160));
    return Response.json({ error: "Invalid email or password." }, { status: 401 });
  }
}
