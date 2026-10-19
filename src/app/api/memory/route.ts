/**
 * GET /api/memory?workspaceId=<id>
 * Returns workspace facts, session summaries, and memory stats.
 */

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getIdentity } from "@/lib/identity";
import { findOwnedWorkspace, usesHostedAppStore } from "@/lib/workspaces/store";
import { hostedAppStore } from "@/lib/workspaces/hosted-dynamo";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const workspaceId = searchParams.get("workspaceId");
  const { userId } = await getIdentity(req);

  if (!workspaceId) {
    return Response.json({ error: "workspaceId required" }, { status: 400 });
  }

  if (usesHostedAppStore()) {
    const owned = await findOwnedWorkspace(userId, workspaceId);
    if (!owned) {
      return Response.json({ error: "Workspace not found" }, { status: 404 });
    }
    const docs = await hostedAppStore().listDocuments(userId, workspaceId);
    const documentFragmentCount = docs.reduce((s, d) => s + (d.chunkCount ?? 0), 0);
    const [facts, summaries] = await Promise.all([
      hostedAppStore().listFacts(userId, workspaceId),
      hostedAppStore().listSessionSummaries(userId, workspaceId),
    ]);
    return Response.json({
      workspaceFacts: facts.slice(0, 80).map(f => ({
        ...f,
        createdAt: f.createdAt,
        updatedAt: f.updatedAt,
        correctedAt: f.correctedAt,
      })),
      sessionSummaries: summaries.slice(0, 50).map(s => ({
        id: s.id,
        sessionId: s.sessionId,
        summary: s.summary,
        turnsCovered: s.turnsCovered,
        updatedAt: s.updatedAt,
        session: { id: s.sessionId, createdAt: s.updatedAt },
      })),
      stats: {
        semanticFragmentCount: 0,
        documentFragmentCount,
      },
    });
  }

  // Ownership has to be established through the workspace before any fact is
  // read, since facts are only reachable by workspaceId.
  const owned = await db.workspace.findFirst({
    where:  { id: workspaceId, userId },
    select: { id: true },
  });
  if (!owned) {
    return Response.json({ error: "Workspace not found" }, { status: 404 });
  }

  const [workspaceFacts, sessionSummaries, semanticFragmentCount, documentFragmentCount] =
    await Promise.all([
      db.workspaceFact.findMany({
        where: { workspaceId },
        orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
        take: 80,
      }),
      db.sessionSummary.findMany({
        where: { session: { workspaceId } },
        orderBy: { updatedAt: "desc" },
        take: 50,
        include: { session: { select: { id: true, createdAt: true } } },
      }),
      db.memoryFragment.count({
        where: { workspaceId, userId, category: { not: "document" } },
      }),
      db.memoryFragment.count({
        where: { workspaceId, userId, category: "document" },
      }),
    ]);

  return Response.json({
    workspaceFacts,
    sessionSummaries,
    stats: {
      semanticFragmentCount,
      documentFragmentCount,
    },
  });
}
