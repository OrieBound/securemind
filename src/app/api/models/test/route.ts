export const runtime = "nodejs";

/**
 * Reachability check for a single model.
 *
 * Bedrock in particular lists far more models than an account can actually
 * invoke: access is granted per model, some ids are region-specific, and some
 * need an inference profile. Rather than making the operator discover that
 * mid-conversation, this sends the smallest possible prompt and reports either
 * a real token or a specific, actionable reason.
 *
 * Admin-only: it spends money, however little.
 */

import { NextRequest } from "next/server";
import { getIdentity, identityErrorResponse } from "@/lib/identity";
import { requireAdmin } from "@/lib/roles";
import { checkModelReachability } from "@/lib/models/reachability";

export async function POST(req: NextRequest) {
  try {
    const identity = await getIdentity(req);
    requireAdmin(identity);

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const modelId = typeof body.modelId === "string" ? body.modelId.trim() : "";
    if (!modelId) {
      return Response.json({ error: "modelId is required" }, { status: 400 });
    }

    const result = await checkModelReachability({
      modelId,
      providerHint: typeof body.provider === "string" ? body.provider : undefined,
      signal: req.signal,
      userId: identity.userId,
    });
    return Response.json(result);
  } catch (err) {
    const res = identityErrorResponse(err);
    if (res) return res;
    throw err;
  }
}
