import { clearAccessCookieHeader } from "@/lib/auth-cookies";

export const runtime = "nodejs";

export async function POST() {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": clearAccessCookieHeader(),
    },
  });
}
