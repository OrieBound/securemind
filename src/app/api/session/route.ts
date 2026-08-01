/**
 * GET /api/session?agentId=xxx
 *
 * Returns the active session for a specific agent, creating one if needed.
 * Also returns messages, rolling summary, and agent-specific facts.
 */

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getIdentity } from "@/lib/identity";

export const runtime = "nodejs";

/** Max messages returned to the client — always the most recent N. */
const MESSAGE_LIMIT = 200;

export async function GET(req: NextRequest) {
  const { userId } = await getIdentity(req);
  const agentId = req.nextUrl.searchParams.get("agentId") ?? "";

  if (!agentId) {
    return Response.json({ error: "agentId is required" }, { status: 400 });
  }

  // Confirm the caller owns this agent before returning anything scoped to it.
  // Without this, agentId alone would expose another user's facts below.
  const owned = await db.agent.findFirst({
    where:  { id: agentId, userId },
    select: { id: true },
  });
  if (!owned) {
    return Response.json({ error: "Agent not found" }, { status: 404 });
  }

  // Resolve the session that actually has the newest message for this companion.
  // updatedAt alone can point at the wrong row when duplicate sessions exist.
  const latestMsg = await db.message.findFirst({
    where:   { session: { userId, agentId } },
    orderBy: { createdAt: "desc" },
    select:  { sessionId: true },
  });

  let session = latestMsg
    ? await db.session.findUnique({
        where:   { id: latestMsg.sessionId },
        include: { summary: true },
      })
    : await db.session.findFirst({
        where:   { userId, agentId },
        orderBy: { updatedAt: "desc" },
        include: { summary: true },
      });

  // Create a new session only when this companion has never chatted before
  if (!session) {
    session = await db.session.create({
      data: { userId, agentId, mode: "Companion" },
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

  // Load only this companion's facts — fully isolated per agent
  const facts = await db.agentFact.findMany({
    where:   { agentId },
    orderBy: { updatedAt: "desc" },
  });

  const factsMap: Record<string, string> = {};
  for (const f of facts) factsMap[f.key] = f.value;

  return Response.json({
    sessionId:       session.id,
    agentId,
    mode:            session.mode,
    messages,
    sessionSummary:  session.summary?.summary ?? "",
    summarizedCount,
    extractedFacts:  factsMap,
  });
}
