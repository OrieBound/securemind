/**
 * GET /api/session?workspaceId=xxx
 *
 * Returns the active session for a workspace, creating one if needed, along
 * with its messages, rolling summary, and workspace-scoped facts.
 */

import { NextRequest } from "next/server";
import { getIdentity } from "@/lib/identity";
import { isAdminRole } from "@/lib/roles";
import { isAdminSetupHello, memberWorkspaceHello } from "@/lib/onboarding";
import { loadSession } from "@/lib/workspaces/store";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { userId, role } = await getIdentity(req);
  const workspaceId = req.nextUrl.searchParams.get("workspaceId") ?? "";

  if (!workspaceId) {
    return Response.json({ error: "workspaceId is required" }, { status: 400 });
  }

  const payload = await loadSession(userId, workspaceId);
  if (!payload) {
    return Response.json({ error: "Workspace not found" }, { status: 404 });
  }
  // The stored opening message is the Admin's setup guide. A member has nothing to set up, so they
  // see the member version instead, including in workspaces that were created before this existed.
  if (!isAdminRole(role)) {
    const first = payload.messages.find(m => m.role === "assistant");
    if (first && isAdminSetupHello(first.content)) {
      const name = /I'm \*\*(.+?)\*\*/.exec(first.content)?.[1] ?? "your workspace";
      first.content = memberWorkspaceHello(name);
    }
  }
  return Response.json(payload);
}
