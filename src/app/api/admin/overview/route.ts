import { NextRequest } from "next/server";
import { getIdentity, IdentityError } from "@/lib/identity";
import { requireAdmin } from "@/lib/roles";
import { getOrgOverview } from "@/lib/admin/overview";
import type { AnalyticsRange } from "@/lib/analytics/types";
import { cognitoAdminAvailable } from "@/lib/cognito-admin";

export const runtime = "nodejs";

const RANGES = new Set<AnalyticsRange>(["today", "7d", "30d", "all"]);

export async function GET(req: NextRequest) {
  try {
    const identity = await getIdentity(req);
    requireAdmin(identity);
  } catch (err) {
    if (err instanceof IdentityError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

  const raw = req.nextUrl.searchParams.get("range") ?? "30d";
  const range: AnalyticsRange = RANGES.has(raw as AnalyticsRange)
    ? (raw as AnalyticsRange)
    : "30d";

  const overview = await getOrgOverview(range);

  // Labels come from /api/admin/users on the client — do not walk Cognito here.
  const byUser = overview.byUser.map(row => ({
    ...row,
    email: null as string | null,
    label: row.userId === "local" ? "local" : `${row.userId.slice(0, 8)}…`,
  }));

  return Response.json({
    ...overview,
    byUser,
    directoryUserCount: 0,
    cognitoAvailable: cognitoAdminAvailable(),
  });
}
