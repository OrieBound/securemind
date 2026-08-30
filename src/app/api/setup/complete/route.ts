import { NextRequest } from "next/server";
import { getIdentity, identityErrorResponse } from "@/lib/identity";
import { setupCompleteCookieHeader, readSetupCompleteCookie } from "@/lib/auth-cookies";
import { runSetupComplete, SetupClaimError } from "@/lib/setup-claim";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const id = await getIdentity(req);
    if (!id.authenticated) {
      return Response.json({ error: "Authentication required." }, { status: 401 });
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const result = await runSetupComplete(id.userId, body, readSetupCompleteCookie(req));
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": setupCompleteCookieHeader(),
      },
    });
  } catch (err) {
    if (err instanceof SetupClaimError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    const res = identityErrorResponse(err);
    if (res) return res;
    throw err;
  }
}
