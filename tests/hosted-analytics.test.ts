import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as WorkspaceStore from "@/lib/workspaces/store";
import {
  createHostedAppStore,
  createMemoryDriver,
  resetHostedAppStoreForTests,
} from "@/lib/workspaces/hosted-dynamo";
import { recordInferenceEvent, recordSecurityEvents } from "@/lib/analytics/write";
import { getCostSummary, getSecuritySummary, getUsageSummary } from "@/lib/analytics/queries";
import { getUsersMonthSpendUsd } from "@/lib/cost-cap";

describe("hosted analytics on Dynamo", () => {
  beforeEach(() => {
    vi.spyOn(WorkspaceStore, "usesHostedAppStore").mockReturnValue(true);
    resetHostedAppStoreForTests(createHostedAppStore(createMemoryDriver()));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetHostedAppStoreForTests();
  });

  it("records inference events and serves Cost / Usage summaries", async () => {
    await recordInferenceEvent({
      userId: "user-a",
      workspaceId: "ws-1",
      provider: "bedrock",
      model: "amazon.nova-lite-v1:0",
      tier: "Standard",
      promptTokens: 100,
      completionTokens: 50,
      latencyMs: 200,
      status: "ok",
      groundingStatus: "not_applicable",
    });

    const cost = await getCostSummary({ userId: "user-a", range: "all" });
    expect(cost.kpis.pricedRequests).toBe(1);
    expect(cost.kpis.estimatedCostUsd).toBeGreaterThan(0);

    const usage = await getUsageSummary({ userId: "user-a", range: "all" });
    expect(usage.kpis.totalRequests).toBe(1);
    expect(usage.kpis.promptTokens).toBe(100);

    const other = await getCostSummary({ userId: "user-b", range: "all" });
    expect(other.kpis.pricedRequests).toBe(0);

    const spend = await getUsersMonthSpendUsd(["user-a", "user-b"]);
    expect(spend.get("user-a")).toBeGreaterThan(0);
    expect(spend.get("user-b")).toBe(0);
  });

  it("records security events without raw values and does not leak across users", async () => {
    const n = await recordSecurityEvents([
      {
        userId: "user-a",
        workspaceId: "ws-1",
        source: "knowledge_document",
        category: "email",
        outcome: "redacted",
        count: 3,
        resourceKind: "document",
        resourceId: "doc-1",
      },
    ]);
    expect(n).toBe(1);

    const mine = await getSecuritySummary({ userId: "user-a", range: "all" });
    expect(mine.kpis.itemsRedacted).toBe(3);
    expect(JSON.stringify(mine)).not.toMatch(/@/);

    const other = await getSecuritySummary({ userId: "user-b", range: "all" });
    expect(other.kpis.itemsRedacted).toBe(0);
  });
});
