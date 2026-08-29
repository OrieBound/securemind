export const runtime = "nodejs";

/**
 * GET /api/runtime/status
 *
 * Lightweight first-run status: detection, parsing, selected provider/model,
 * and Ollama reachability. Does not list cloud catalogs or pull models.
 */

import { NextRequest } from "next/server";
import { getIdentity, identityErrorResponse } from "@/lib/identity";
import { getRuntimeStatus } from "@/lib/models/runtime-status";

export async function GET(req: NextRequest) {
  try {
    await getIdentity(req);
  } catch (err) {
    const res = identityErrorResponse(err);
    if (res) return res;
    throw err;
  }

  const status = await getRuntimeStatus();
  return Response.json(status);
}
