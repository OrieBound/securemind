export const runtime = "nodejs";

/**
 * Admin-only: label + workspace list for Insights drill-down (?asUser=).
 */

import { NextRequest, NextResponse } from "next/server";
import { getIdentity, IdentityError } from "@/lib/identity";
import { requireAdmin } from "@/lib/roles";
import { getInsightsSubjectMeta } from "@/lib/analytics/subject";

export async function GET(req: NextRequest) {
  let identity;
  try {
    identity = await getIdentity(req);
    requireAdmin(identity);
  } catch (err) {
    if (err instanceof IdentityError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

  const userId = new URL(req.url).searchParams.get("userId")?.trim() ?? "";
  if (!userId || userId.length > 128) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const meta = await getInsightsSubjectMeta(userId);
  if (!meta) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json(meta);
}
