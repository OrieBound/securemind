import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createHostedAppStore,
  createMemoryDriver,
  resetHostedAppStoreForTests,
} from "@/lib/workspaces/hosted-dynamo";

vi.mock("@/lib/workspaces/store", () => ({ usesHostedAppStore: () => true }));
vi.mock("@/lib/db", () => ({ db: {} }));

import { listAudit, recordAudit } from "@/lib/audit-log";

const admin = { userId: "u-admin", email: "a@example.test", role: "admin" as const };

describe("audit log (hosted store)", () => {
  beforeEach(() => {
    resetHostedAppStoreForTests(createHostedAppStore(createMemoryDriver()));
  });

  it("records actor, action and target, newest first", async () => {
    await recordAudit(admin, "user.create", { target: "b@example.test", detail: "role=member" });
    await new Promise(r => setTimeout(r, 5));
    await recordAudit(admin, "user.disabled", { target: "b@example.test" });
    const rows = await listAudit();
    expect(rows.map(r => r.action)).toEqual(["user.disabled", "user.create"]);
    expect(rows[1]).toMatchObject({ actorUserId: "u-admin", actorRole: "admin", outcome: "ok" });
  });

  it("truncates long detail and never throws when the store fails", async () => {
    await recordAudit(admin, "x", { detail: "d".repeat(500) });
    expect((await listAudit())[0].detail).toHaveLength(200);
    resetHostedAppStoreForTests({
      putAudit: async () => {
        throw new Error("down");
      },
    } as never);
    await expect(recordAudit(admin, "y")).resolves.toBeUndefined();
  });
});
