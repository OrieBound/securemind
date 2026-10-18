export const runtime = "nodejs";

/** GET /api/admin/audit — recent administrative actions. Admin only. */

import { NextRequest, NextResponse } from "next/server";
import { getIdentity, identityErrorResponse } from "@/lib/identity";
import { requireAdmin } from "@/lib/roles";
import { listAudit } from "@/lib/audit-log";

export async function GET(req: NextRequest) {
  try {
    requireAdmin(await getIdentity(req));
  } catch (err) {
    const res = identityErrorResponse(err);
    if (res) return res;
    throw err;
  }
  const take = Number(new URL(req.url).searchParams.get("take") ?? "200");
  const events = await listAudit(Number.isFinite(take) ? take : 200);
  return NextResponse.json({ events }, { headers: { "Cache-Control": "no-store" } });
}
