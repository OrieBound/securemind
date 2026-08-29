export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getIdentity, IdentityError } from "@/lib/identity";
import { getCostSummary, resolveWorkspaceScope } from "@/lib/analytics/queries";
import { resolveAnalyticsSubject } from "@/lib/analytics/subject";
import type { AnalyticsRange } from "@/lib/analytics/types";
import { getUserCostCapStatus } from "@/lib/cost-cap";

const RANGES = new Set<AnalyticsRange>(["today", "7d", "30d", "all"]);

export async function GET(req: NextRequest) {
  let identity;
  try {
    identity = await getIdentity(req);
  } catch (err) {
    if (err instanceof IdentityError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

  const url = new URL(req.url);
  const subject = await resolveAnalyticsSubject(identity, url.searchParams.get("asUser"));
  if (!subject.ok) {
    return NextResponse.json({ error: subject.error }, { status: subject.status });
  }

  const rangeParam = (url.searchParams.get("range") ?? "30d") as AnalyticsRange;
  const range = RANGES.has(rangeParam) ? rangeParam : "30d";
  const scope = await resolveWorkspaceScope(subject.userId, url.searchParams.get("workspaceId"));
  if (!scope.ok) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  try {
    const [summary, monthCap] = await Promise.all([
      getCostSummary({
        userId: subject.userId,
        range,
        workspaceId: scope.workspaceId,
      }),
      getUserCostCapStatus(subject.userId),
    ]);
    return NextResponse.json({
      ...summary,
      monthCap: {
        spentUsd: monthCap.spentUsd,
        capUsd: monthCap.capUsd,
        resetsAt: monthCap.resetsAt,
        capped: monthCap.capped,
        warningLevel: monthCap.warningLevel,
      },
    });
  } catch (err) {
    console.error("[analytics/cost] GET failed:", err);
    return NextResponse.json(
      { error: "Failed to load cost analytics. Restart the dev server after schema changes." },
      { status: 500 },
    );
  }
}
