import { describe, expect, it } from "vitest";
import {
  createHostedAppStore,
  createMemoryDriver,
} from "@/lib/workspaces/hosted-dynamo";
import { DEFAULT_WORKSPACE_NAME } from "@/lib/workspaces/defaults";

describe("hosted app store", () => {
  it("seeds Mindy Locke when the user has no workspaces", async () => {
    const store = createHostedAppStore(createMemoryDriver());
    const list = await store.listWorkspaces("user-a");
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe(DEFAULT_WORKSPACE_NAME);
    expect(list[0]?.isDefault).toBe(true);
    expect(list[0]?.userId).toBe("user-a");
  });

  it("does not return another user's workspaces", async () => {
    const store = createHostedAppStore(createMemoryDriver());
    await store.listWorkspaces("user-a");
    await store.createWorkspace("user-a", { name: "Alpha" });
    const other = await store.listWorkspaces("user-b");
    expect(other).toHaveLength(1);
    expect(other[0]?.name).toBe(DEFAULT_WORKSPACE_NAME);
    expect(other.every(w => w.userId === "user-b")).toBe(true);
  });

  it("creates extra workspaces and loads a default hello on first session", async () => {
    const store = createHostedAppStore(createMemoryDriver());
    const [seed] = await store.listWorkspaces("user-a");
    const extra = await store.createWorkspace("user-a", { name: "Incidents" });
    expect(extra.name).toBe("Incidents");
    expect(extra.isDefault).toBe(false);

    const session = await store.loadSession("user-a", seed!.id);
    expect(session?.messages[0]?.role).toBe("assistant");
    expect(session?.messages[0]?.content).toContain("Getting started");

    const empty = await store.loadSession("user-a", extra.id);
    expect(empty?.messages).toEqual([]);
  });

  it("rewrites the legacy first-workspace hello on load", async () => {
    const driver = createMemoryDriver();
    const store = createHostedAppStore(driver);
    const [seed] = await store.listWorkspaces("user-a");
    const session = await store.loadSession("user-a", seed!.id);
    const first = session?.messages[0];
    expect(first).toBeTruthy();

    const legacy =
      "Hi — I'm **Mindy Locke**, your first workspace.\n\nFeel free to change my name anytime in **Workspace** settings. When you're ready, upload Knowledge or ask a question — I'll stay grounded in what you add here.";
    await driver.put(
      `app#user-a`,
      `ms#${first!.sessionId}#${first!.createdAt}#${first!.id}`,
      {
        userId: { S: "user-a" },
        category: { S: "app_meta" },
        content: { S: JSON.stringify({ ...first, content: legacy }) },
      },
    );

    const reloaded = await store.loadSession("user-a", seed!.id);
    expect(reloaded?.messages[0]?.content).toContain("Getting started");
    expect(reloaded?.messages[0]?.content).not.toContain("Feel free to change my name");
  });

  it("refuses to append to another user's session", async () => {
    const store = createHostedAppStore(createMemoryDriver());
    const [seed] = await store.listWorkspaces("user-a");
    const session = await store.loadSession("user-a", seed!.id);
    const stolen = await store.appendMessage("user-b", session!.sessionId, "user", "hello");
    expect(stolen).toBeNull();
  });

  it("stores a profile per user partition", async () => {
    const store = createHostedAppStore(createMemoryDriver());
    await store.putProfile({
      userId: "user-a",
      email: "a@example.com",
      displayName: "Ada",
      handle: "ada",
      jobTitle: null,
      bio: null,
      timezone: null,
      locale: null,
      avatarPreset: "slate",
      themePreference: "dark",
      density: null,
      defaultLanding: null,
      defaultWorkspaceId: null,
      preferredModelId: null,
      notificationPrefs: null,
      status: "active",
      monthlyCostCapUsd: 10,
      lastSignInAt: null,
      deletedAt: null,
      deletedByUserId: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect((await store.getProfile("user-a"))?.displayName).toBe("Ada");
    expect(await store.getProfile("user-b")).toBeNull();
  });

  it("lists documents only for the owning user", async () => {
    const store = createHostedAppStore(createMemoryDriver());
    await store.putDocument({
      id: "doc-1",
      userId: "user-a",
      workspaceId: "ws-1",
      name: "notes.txt",
      mimeType: "text/plain",
      sizeBytes: 12,
      description: null,
      status: "ready",
      chunkCount: 1,
      redactionCount: 0,
      scrubEvents: null,
      processingError: null,
      storageKey: null,
      extractMeta: null,
      processedAt: null,
      content: "hello",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      fragmentIds: ["f1"],
      chunks: [],
    });
    const mine = await store.listDocuments("user-a", "ws-1");
    expect(mine).toHaveLength(1);
    expect(await store.getDocument("user-b", "doc-1")).toBeNull();
  });

  it("stores bookmarks only for the owning user", async () => {
    const store = createHostedAppStore(createMemoryDriver());
    await store.putBookmark({
      id: "bm-1",
      userId: "user-a",
      workspaceId: "ws-1",
      messageId: "msg-1",
      label: "Bookmark",
      preview: "hello",
      role: "assistant",
      heavy: false,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(await store.listBookmarks("user-a", "ws-1")).toHaveLength(1);
    expect(await store.listBookmarks("user-b", "ws-1")).toHaveLength(0);
    expect(await store.deleteBookmark("user-b", "ws-1", "msg-1")).toBeNull();
    expect(await store.deleteBookmark("user-a", "ws-1", "msg-1")).not.toBeNull();
  });

  it("stores inference and security events on the owner partition", async () => {
    const store = createHostedAppStore(createMemoryDriver());
    await store.putInferenceEvent({
      id: "ie-1",
      userId: "user-a",
      workspaceId: "ws-1",
      sessionId: null,
      messageId: null,
      at: "2026-08-15T12:00:00.000Z",
      provider: "bedrock",
      model: "amazon.nova-lite-v1:0",
      tier: "Standard",
      promptTokens: 10,
      completionTokens: 20,
      latencyMs: 100,
      status: "ok",
      retrievalHitCount: 0,
      citationCount: 0,
      groundingStatus: "not_applicable",
      estimatedCostUsd: 0.001,
      pricingVersion: "test",
      turnMode: null,
      retrievalAttempted: false,
      retrievalReasonCode: null,
      candidateCount: 0,
      evidenceCount: 0,
      sourcesCited: 0,
      retrievalMs: null,
      insufficientEvidence: false,
      attachmentUsed: false,
    });
    await store.putSecurityEvent({
      id: "se-1",
      userId: "user-a",
      workspaceId: "ws-1",
      at: "2026-08-15T12:00:00.000Z",
      source: "knowledge_document",
      category: "email",
      riskLevel: "medium",
      outcome: "redacted",
      count: 2,
      sensitivity: "balanced",
      resourceKind: "document",
      resourceId: "doc-1",
    });
    expect(await store.listInferenceEvents("user-a")).toHaveLength(1);
    expect(await store.listInferenceEvents("user-b")).toHaveLength(0);
    const mine = await store.listSecurityEvents("user-a");
    expect(mine[0]?.count).toBe(2);
    expect(await store.listSecurityEvents("user-b")).toHaveLength(0);
  });

  it("upserts workspace facts without crossing users", async () => {
    const store = createHostedAppStore(createMemoryDriver());
    await store.putFact({
      id: "f1",
      userId: "user-a",
      workspaceId: "ws-1",
      key: "name",
      value: "Ada",
      confidence: 0.8,
      source: "session-1",
      pinned: false,
      forgotten: false,
      correctedAt: null,
      correctedByUserId: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect((await store.listFacts("user-a", "ws-1"))[0]?.value).toBe("Ada");
    expect(await store.listFacts("user-b", "ws-1")).toHaveLength(0);
    expect(await store.deleteFact("user-b", "ws-1", "f1")).toBeNull();
    expect(await store.deleteFact("user-a", "ws-1", "f1")).not.toBeNull();
  });
});
