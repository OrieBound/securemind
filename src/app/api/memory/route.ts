/**
 * GET /api/memory?agentId=<id>
 * Returns AgentFacts, UserFacts, SessionSummaries, and memory layer stats.
 */

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getIdentity } from "@/lib/identity";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const agentId = searchParams.get("agentId");
  const { userId } = await getIdentity(req);

  if (!agentId) {
    return Response.json({ error: "agentId required" }, { status: 400 });
  }

  // AgentFact has no userId column, so ownership has to be established through
  // the agent before any fact is read.
  const owned = await db.agent.findFirst({
    where:  { id: agentId, userId },
    select: { id: true },
  });
  if (!owned) {
    return Response.json({ error: "Agent not found" }, { status: 404 });
  }

  const [agentFacts, userFacts, sessionSummaries, semanticFragmentCount, documentFragmentCount] =
    await Promise.all([
      db.agentFact.findMany({
        where: { agentId },
        orderBy: { updatedAt: "desc" },
      }),
      db.userFact.findMany({
        where: { userId },
        orderBy: { updatedAt: "desc" },
      }),
      db.sessionSummary.findMany({
        where: { session: { agentId } },
        orderBy: { updatedAt: "desc" },
        take: 50,
        include: { session: { select: { id: true, createdAt: true } } },
      }),
      db.memoryFragment.count({
        where: { agentId, userId, category: { not: "document" } },
      }),
      db.memoryFragment.count({
        where: { agentId, userId, category: "document" },
      }),
    ]);

  return Response.json({
    agentFacts,
    userFacts,
    sessionSummaries,
    stats: {
      semanticFragmentCount,
      documentFragmentCount,
    },
  });
}
