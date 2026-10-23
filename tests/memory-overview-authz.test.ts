/**
 * /api/memory/overview is workspace-scoped. The workspace id comes from the query string, so the
 * route must establish ownership for the server-derived user before reading anything, answer 404
 * (not 403) for someone else's workspace, and never return another workspace's documents.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const resolveWorkspaceScope = vi.fn();
const getUsageSummary = vi.fn();
const getSecuritySummary = vi.fn();
const listPersistedDocuments = vi.fn();

vi.mock("@/lib/identity", () => ({ getIdentity: async () => ({ userId: "user-a" }) }));
vi.mock("@/lib/analytics/queries", () => ({ resolveWorkspaceScope, getUsageSummary, getSecuritySummary }));
vi.mock("@/lib/documents/persist", () => ({ listPersistedDocuments }));

function get(workspaceId?: string) {
  const url = new URL("http://localhost/api/memory/overview");
  if (workspaceId) url.searchParams.set("workspaceId", workspaceId);
  return new NextRequest(url);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/memory/overview", () => {
  it("returns 404 for a workspace the caller does not own, without reading data", async () => {
    const { GET } = await import("@/app/api/memory/overview/route");
    resolveWorkspaceScope.mockResolvedValue({ ok: false });

    const res = await GET(get("someone-elses"));

    expect(res.status).toBe(404);
    expect(resolveWorkspaceScope).toHaveBeenCalledWith("user-a", "someone-elses");
    expect(listPersistedDocuments).not.toHaveBeenCalled();
    expect(getUsageSummary).not.toHaveBeenCalled();
    expect(getSecuritySummary).not.toHaveBeenCalled();
  });

  it("requires a workspace id", async () => {
    const { GET } = await import("@/app/api/memory/overview/route");
    const res = await GET(get());
    expect(res.status).toBe(400);
  });

  it("scopes every read to the owned workspace and drops documents from elsewhere", async () => {
    const { GET } = await import("@/app/api/memory/overview/route");
    resolveWorkspaceScope.mockResolvedValue({ ok: true, workspaceId: "w1" });
    listPersistedDocuments.mockResolvedValue([
      { id: "d1", workspaceId: "w1", name: "a.pdf", mimeType: "application/pdf", sizeBytes: 1, status: "ready", chunkCount: 3, redactionCount: 0, createdAt: new Date("2026-01-01") },
      { id: "d2", workspaceId: null, name: "old.txt", mimeType: "text/plain", sizeBytes: 1, status: "ready", chunkCount: 1, redactionCount: 0, createdAt: new Date("2026-01-01") },
      { id: "d3", workspaceId: "w2", name: "other.txt", mimeType: "text/plain", sizeBytes: 1, status: "ready", chunkCount: 1, redactionCount: 0, createdAt: new Date("2026-01-01") },
    ]);
    getUsageSummary.mockResolvedValue({ kpis: { totalRequests: 0 } });
    getSecuritySummary.mockResolvedValue({ kpis: { itemsRedacted: 0 }, byCategory: [], bySource: [] });

    const res = await GET(get("w1"));
    const body = await res.json();

    expect(listPersistedDocuments).toHaveBeenCalledWith("user-a", "w1");
    expect(getUsageSummary).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-a", workspaceId: "w1" }));
    expect(getSecuritySummary).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-a", workspaceId: "w1" }));
    expect(body.documents.map((d: { id: string }) => d.id)).toEqual(["d1"]);
    expect(body.evidence).toBeNull();
    expect(body.privacy).toBeNull();
  });
});
