export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getIdentity, IdentityError } from "@/lib/identity";
import { getUsageSummary, resolveWorkspaceScope } from "@/lib/analytics/queries";
import type { AnalyticsRange } from "@/lib/analytics/types";

const RANGES = new Set<AnalyticsRange>(["today", "7d", "30d", "all"]);

export async function GET(req: NextRequest) {
  let userId: string;
  try {
    ({ userId } = await getIdentity(req));
  } catch (err) {
    if (err instanceof IdentityError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

  const url = new URL(req.url);
  const rangeParam = (url.searchParams.get("range") ?? "30d") as AnalyticsRange;
  const range = RANGES.has(rangeParam) ? rangeParam : "30d";
  const scope = await resolveWorkspaceScope(userId, url.searchParams.get("workspaceId"));
  if (!scope.ok) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  const summary = await getUsageSummary({
    userId,
    range,
    workspaceId: scope.workspaceId,
  });
  return NextResponse.json(summary);
}
