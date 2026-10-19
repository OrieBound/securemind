/**
 * GET /api/session?workspaceId=xxx
 *
 * Returns the active session for a workspace, creating one if needed, along
 * with its messages, rolling summary, and workspace-scoped facts.
 */

import { NextRequest } from "next/server";
import { getIdentity } from "@/lib/identity";
import { loadSession } from "@/lib/workspaces/store";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { userId } = await getIdentity(req);
  const workspaceId = req.nextUrl.searchParams.get("workspaceId") ?? "";

  if (!workspaceId) {
    return Response.json({ error: "workspaceId is required" }, { status: 400 });
  }

  const payload = await loadSession(userId, workspaceId);
  if (!payload) {
    return Response.json({ error: "Workspace not found" }, { status: 404 });
  }
  return Response.json(payload);
}
