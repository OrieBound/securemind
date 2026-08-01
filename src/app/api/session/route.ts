/**
 * GET /api/session?workspaceId=xxx
 *
 * Returns the active session for a workspace, creating one if needed, along
 * with its messages, rolling summary, and workspace-scoped facts.
 */

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getIdentity } from "@/lib/identity";

export const runtime = "nodejs";

/** Max messages returned to the client — always the most recent N. */
const MESSAGE_LIMIT = 200;

export async function GET(req: NextRequest) {
  const { userId } = await getIdentity(req);
  const workspaceId = req.nextUrl.searchParams.get("workspaceId") ?? "";

  if (!workspaceId) {
    return Response.json({ error: "workspaceId is required" }, { status: 400 });
  }

  // Confirm the caller owns this workspace before returning anything scoped to
  // it. Without this, workspaceId alone would expose another user's facts.
  const owned = await db.workspace.findFirst({
    where:  { id: workspaceId, userId },
    select: { id: true },
  });
  if (!owned) {
    return Response.json({ error: "Workspace not found" }, { status: 404 });
  }

  // Resolve the session that actually has the newest message for this
  // workspace. updatedAt alone can point at the wrong row when duplicate
  // sessions exist.
  const latestMsg = await db.message.findFirst({
    where:   { session: { userId, workspaceId } },
    orderBy: { createdAt: "desc" },
    select:  { sessionId: true },
  });

  let session = latestMsg
    ? await db.session.findUnique({
        where:   { id: latestMsg.sessionId },
        include: { summary: true },
      })
    : await db.session.findFirst({
        where:   { userId, workspaceId },
        orderBy: { updatedAt: "desc" },
        include: { summary: true },
      });

  // Create a new session only when this workspace has never been used before.
  if (!session) {
    session = await db.session.create({
      data: { userId, workspaceId },
      include: { summary: true },
    });
  }

  // Load the *latest* MESSAGE_LIMIT messages (not the oldest).
  // Prisma take+asc returns the first N rows — wrong for long threads.
  const [totalCount, recentDesc] = await Promise.all([
    db.message.count({ where: { sessionId: session.id } }),
    db.message.findMany({
      where:   { sessionId: session.id },
      orderBy: { createdAt: "desc" },
      take:    MESSAGE_LIMIT,
    }),
  ]);
  const messages = recentDesc.reverse();

  // If we trimmed older messages, shift summarizedCount so the client
  // doesn't re-summarize or drop working-memory context incorrectly.
  const skipped = Math.max(0, totalCount - messages.length);
  const rawSummarized = session.summary?.turnsCovered ?? 0;
  const summarizedCount = Math.max(0, rawSummarized - skipped);

  // Only this workspace's facts — no cross-workspace bleed.
  const facts = await db.workspaceFact.findMany({
    where:   { workspaceId },
    orderBy: { updatedAt: "desc" },
  });

  const factsMap: Record<string, string> = {};
  for (const f of facts) factsMap[f.key] = f.value;

  return Response.json({
    sessionId:      session.id,
    workspaceId,
    messages,
    sessionSummary: session.summary?.summary ?? "",
    summarizedCount,
    extractedFacts: factsMap,
  });
}
