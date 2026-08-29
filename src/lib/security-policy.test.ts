import { beforeEach, describe, expect, it, vi } from "vitest";

const documentFindMany = vi.fn();
const documentUpdate = vi.fn();
const instanceConfigUpdate = vi.fn();
const getInstanceConfig = vi.fn();
const ensureInstanceConfig = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    document: {
      findMany: (...args: unknown[]) => documentFindMany(...args),
      update: (...args: unknown[]) => documentUpdate(...args),
    },
    instanceConfig: {
      update: (...args: unknown[]) => instanceConfigUpdate(...args),
    },
  },
}));

vi.mock("@/lib/instance-config", () => ({
  ensureInstanceConfig: (...args: unknown[]) => ensureInstanceConfig(...args),
  getInstanceConfig: (...args: unknown[]) => getInstanceConfig(...args),
}));

import { applySecurityPolicy } from "./security-policy";

describe("applySecurityPolicy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureInstanceConfig.mockResolvedValue(undefined);
    instanceConfigUpdate.mockResolvedValue({});
    getInstanceConfig.mockResolvedValue({
      piiSensitivity: "extreme",
      safeTerms: [],
      pendingPiiSensitivity: null,
      pendingSafeTerms: null,
      pendingProposedByUserId: null,
      pendingProposedAt: null,
      pendingNote: null,
      updatedAt: new Date("2026-08-05T00:00:00Z"),
      updatedByUserId: "admin-1",
    });
  });

  it("applies a stricter tier without scanning or rewriting documents", async () => {
    const result = await applySecurityPolicy({
      actorUserId: "admin-1",
      piiSensitivity: "extreme",
      safeTerms: [],
    });

    expect(instanceConfigUpdate).toHaveBeenCalledWith({
      where: { id: "singleton" },
      data: expect.objectContaining({
        piiSensitivity: "extreme",
        safeTerms: [],
        updatedByUserId: "admin-1",
      }),
    });
    expect(result.policy.piiSensitivity).toBe("extreme");
    expect(documentFindMany).not.toHaveBeenCalled();
    expect(documentUpdate).not.toHaveBeenCalled();
  });
});
