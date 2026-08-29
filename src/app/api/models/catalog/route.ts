export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getIdentity, identityErrorResponse } from "@/lib/identity";
import { getModelCatalogCached } from "@/lib/models/catalog";

export async function GET(req: NextRequest) {
  try {
    const identity = await getIdentity(req);
    const fresh = req.nextUrl.searchParams.get("fresh") === "1";
    const catalog = await getModelCatalogCached({ fresh });
    return Response.json({
      ...catalog,
      role: identity.role,
    });
  } catch (err) {
    const res = identityErrorResponse(err);
    if (res) return res;
    throw err;
  }
}
