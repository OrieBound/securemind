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
    expect(session?.messages[0]?.content).toContain(DEFAULT_WORKSPACE_NAME);

    const empty = await store.loadSession("user-a", extra.id);
    expect(empty?.messages).toEqual([]);
  });

  it("refuses to append to another user's session", async () => {
    const store = createHostedAppStore(createMemoryDriver());
    const [seed] = await store.listWorkspaces("user-a");
    const session = await store.loadSession("user-a", seed!.id);
    const stolen = await store.appendMessage("user-b", session!.sessionId, "user", "hello");
    expect(stolen).toBeNull();
  });
});
