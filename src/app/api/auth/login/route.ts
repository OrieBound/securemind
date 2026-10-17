import { NextRequest } from "next/server";
import { cognitoLoginStart, cognitoConfigured } from "@/lib/cognito";
import { completeLogin } from "@/lib/auth-login";

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
    const step = await cognitoLoginStart(email, password);
    if (step.kind === "mfa") {
      // Password was right and this account has two-step verification on. No session yet:
      // the browser sends the code, with this session, to /api/auth/login/mfa.
      return Response.json(
        { mfaRequired: true, session: step.session },
        { status: 200, headers: { "Cache-Control": "no-store" } },
      );
    }
    return await completeLogin(email, step.tokens);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Login failed";
    console.warn("[auth/login]", msg.slice(0, 160));
    return Response.json({ error: "Invalid email or password." }, { status: 401 });
  }
}
