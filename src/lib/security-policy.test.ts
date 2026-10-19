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

import { applySecurityPolicy, getSecurityPolicy, mergeSafeTerms } from "./security-policy";

describe("applySecurityPolicy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureInstanceConfig.mockResolvedValue(undefined);
    instanceConfigUpdate.mockResolvedValue({});
    getInstanceConfig.mockResolvedValue({
      piiSensitivity: "high",
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
      piiSensitivity: "high",
      safeTerms: [],
    });

    expect(instanceConfigUpdate).toHaveBeenCalledWith({
      where: { id: "singleton" },
      data: expect.objectContaining({
        piiSensitivity: "high",
        safeTerms: [],
        updatedByUserId: "admin-1",
      }),
    });
    expect(result.policy.piiSensitivity).toBe("high");
    expect(documentFindMany).not.toHaveBeenCalled();
    expect(documentUpdate).not.toHaveBeenCalled();
  });
});

describe("getSecurityPolicy", () => {
  it("maps stored extreme to high", async () => {
    ensureInstanceConfig.mockResolvedValue(undefined);
    getInstanceConfig.mockResolvedValue({
      piiSensitivity: "extreme",
      safeTerms: [],
      pendingPiiSensitivity: "extreme",
      pendingSafeTerms: null,
      pendingProposedByUserId: "admin-1",
      pendingProposedAt: new Date("2026-08-05T00:00:00Z"),
      pendingNote: null,
      updatedAt: new Date("2026-08-05T00:00:00Z"),
      updatedByUserId: "admin-1",
    });
    const policy = await getSecurityPolicy();
    expect(policy.piiSensitivity).toBe("high");
    expect(policy.pending?.piiSensitivity).toBe("high");
  });
});

describe("mergeSafeTerms", () => {
  it("includes RFC 2606 example.* domains from shipped defaults", () => {
    const merged = mergeSafeTerms([]);
    expect(merged.some(t => t.value === "example.com")).toBe(true);
    expect(merged.some(t => t.value === "test")).toBe(true);
  });
});
