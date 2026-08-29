/**
 * Regression guards for Admin / Insights / Knowledge payload bounds.
 *
 * Targets (local, same-origin, warm):
 * - Admin overview: groupBy/aggregate only — never load every telemetry row
 * - Directory spend: one groupBy for the month, not N aggregates
 * - Document list: preview only (no `content` field)
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const workspace = { groupBy: vi.fn() };
const document = { groupBy: vi.fn() };
const inferenceEvent = { groupBy: vi.fn(), aggregate: vi.fn() };
const securityEvent = { groupBy: vi.fn(), aggregate: vi.fn() };

vi.mock("@/lib/db", () => ({
  db: { workspace, document, inferenceEvent, securityEvent },
}));

beforeEach(() => {
  vi.clearAllMocks();
  workspace.groupBy.mockResolvedValue([]);
  document.groupBy.mockResolvedValue([]);
  inferenceEvent.groupBy.mockResolvedValue([]);
  inferenceEvent.aggregate.mockResolvedValue({ _sum: { estimatedCostUsd: 0 } });
  securityEvent.groupBy.mockResolvedValue([]);
  securityEvent.aggregate.mockResolvedValue({ _sum: { count: 0 } });
});

describe("getOrgOverview", () => {
  it("aggregates in the database instead of findMany-all", async () => {
    const { getOrgOverview } = await import("@/lib/admin/overview");
    workspace.groupBy.mockResolvedValue([{ userId: "u1", _count: { _all: 2 } }]);
    document.groupBy.mockResolvedValue([{ userId: "u1", _count: { _all: 3 } }]);
    inferenceEvent.groupBy.mockResolvedValue([
      {
        userId: "u1",
        _count: { _all: 4 },
        _sum: { promptTokens: 10, completionTokens: 5, estimatedCostUsd: 0.02 },
      },
    ]);
    securityEvent.groupBy.mockResolvedValue([{ userId: "u1", _sum: { count: 7 } }]);
    securityEvent.aggregate.mockResolvedValue({ _sum: { count: 1 } });

    const overview = await getOrgOverview("7d");

    expect(overview.workspaceCount).toBe(2);
    expect(overview.documentCount).toBe(3);
    expect(overview.inferenceRequests).toBe(4);
    expect(overview.securityEvents).toBe(7);
    expect(overview.highRiskBlocked).toBe(1);
    expect(overview.byUser).toHaveLength(1);
    expect(workspace.groupBy).toHaveBeenCalled();
    expect(inferenceEvent.groupBy).toHaveBeenCalled();
    expect((workspace as { findMany?: unknown }).findMany).toBeUndefined();
  });
});

describe("getUsersMonthSpendUsd", () => {
  it("returns zeros for an empty id list without querying", async () => {
    const { getUsersMonthSpendUsd } = await import("@/lib/cost-cap");
    const map = await getUsersMonthSpendUsd([]);
    expect(map.size).toBe(0);
    expect(inferenceEvent.groupBy).not.toHaveBeenCalled();
  });

  it("batches monthly spend into one groupBy", async () => {
    const { getUsersMonthSpendUsd } = await import("@/lib/cost-cap");
    inferenceEvent.groupBy.mockResolvedValue([
      { userId: "a", _sum: { estimatedCostUsd: 1.25 } },
    ]);
    const map = await getUsersMonthSpendUsd(["a", "b", "a"]);
    expect(inferenceEvent.groupBy).toHaveBeenCalledTimes(1);
    expect(map.get("a")).toBe(1.25);
    expect(map.get("b")).toBe(0);
  });
});
