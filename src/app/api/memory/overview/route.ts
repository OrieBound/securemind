/**
 * GET /api/memory/overview?workspaceId=<id>
 *
 * What a workspace's Memory page shows beyond facts: its document library, how often answers used
 * Knowledge, and how many sensitive values were replaced here. Everything is derived from data the
 * app already records (documents, inference events, security events). Counts and category names
 * only; no message text, document text or detected values.
 */

import { NextRequest } from "next/server";
import { getIdentity } from "@/lib/identity";
import { getSecuritySummary, getUsageSummary, resolveWorkspaceScope } from "@/lib/analytics/queries";
import { listPersistedDocuments } from "@/lib/documents/persist";
import type { MemoryOverview, MemoryOverviewDocument } from "@/lib/memory/overview-types";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const workspaceId = new URL(req.url).searchParams.get("workspaceId");
  const { userId } = await getIdentity(req);

  if (!workspaceId) {
    return Response.json({ error: "workspaceId required" }, { status: 400 });
  }
  const scope = await resolveWorkspaceScope(userId, workspaceId);
  if (!scope.ok || !scope.workspaceId) {
    return Response.json({ error: "Workspace not found" }, { status: 404 });
  }
  const scopedId = scope.workspaceId;

  const [docs, usage, security] = await Promise.allSettled([
    listPersistedDocuments(userId, scopedId),
    getUsageSummary({ userId, range: "all", workspaceId: scopedId }),
    getSecuritySummary({ userId, range: "all", workspaceId: scopedId }),
  ]);

  const documents: MemoryOverviewDocument[] =
    docs.status === "fulfilled"
      ? docs.value
          // The shared list also returns older documents with no workspace. This page is one workspace.
          .filter(d => d.workspaceId === scopedId)
          .map(d => ({
            id: d.id,
            name: d.name,
            mimeType: d.mimeType,
            sizeBytes: d.sizeBytes,
            status: d.status,
            chunkCount: d.chunkCount,
            redactionCount: d.redactionCount,
            createdAt: new Date(d.createdAt).toISOString(),
          }))
      : [];

  const evidence =
    usage.status === "fulfilled" && usage.value.kpis.totalRequests > 0
      ? {
          answers: usage.value.kpis.totalRequests,
          usedKnowledgeRate: usage.value.kpis.retrievalHitRate,
          citedRate: usage.value.kpis.citationUsageRate,
          groundedRate: usage.value.kpis.groundedRate,
        }
      : null;

  const privacy =
    security.status === "fulfilled" && security.value.kpis.itemsRedacted > 0
      ? {
          itemsReplaced: security.value.kpis.itemsRedacted,
          byCategory: security.value.byCategory.slice(0, 6),
          bySource: security.value.bySource,
        }
      : null;

  const body: MemoryOverview = { documents, evidence, privacy };
  return Response.json(body);
}
