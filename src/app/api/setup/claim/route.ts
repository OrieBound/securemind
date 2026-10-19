import { authRateLimit } from "@/lib/rate-limit";
import { NextRequest } from "next/server";
import { accessCookieHeader } from "@/lib/auth-cookies";
import { runFirstAdminClaim, SetupClaimError } from "@/lib/setup-claim";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const limited = authRateLimit(req, "setup-claim", typeof body.email === "string" ? body.email : null);
  if (limited) return limited;

  try {
    const result = await runFirstAdminClaim(body);
    return new Response(
      JSON.stringify({
        ok: true,
        expiresIn: result.expiresIn,
        accessToken: result.accessToken,
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Set-Cookie": accessCookieHeader(result.accessToken, result.expiresIn),
        },
      },
    );
  } catch (err) {
    if (err instanceof SetupClaimError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    console.warn("[setup/claim]", err instanceof Error ? err.message.slice(0, 160) : err);
    return Response.json({ error: "Could not complete instance setup." }, { status: 500 });
  }
}
