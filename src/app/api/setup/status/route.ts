import { NextRequest } from "next/server";
import { getSetupStatus } from "@/lib/setup-claim";
import { readSetupCompleteCookie } from "@/lib/auth-cookies";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const status = await getSetupStatus({
    cookieSetupComplete: readSetupCompleteCookie(req),
  });
  return Response.json(status);
}
