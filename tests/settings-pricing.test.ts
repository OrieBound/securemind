import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getIdentity = vi.fn();
const getPricingRateOverrides = vi.fn();
const savePricingRateOverrides = vi.fn();

vi.mock("@/lib/identity", async () => {
  const actual = await vi.importActual<typeof import("@/lib/identity")>("@/lib/identity");
  return {
    ...actual,
    getIdentity: (...args: unknown[]) => getIdentity(...args),
  };
});

vi.mock("@/lib/pricing/rate-overrides-store", () => ({
  getPricingRateOverrides: (...args: unknown[]) => getPricingRateOverrides(...args),
  savePricingRateOverrides: (...args: unknown[]) => savePricingRateOverrides(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  getPricingRateOverrides.mockResolvedValue({});
  savePricingRateOverrides.mockImplementation(async (map: unknown) => map);
});

function put(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/settings/pricing", {
    method: "PUT",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("PUT /api/settings/pricing", () => {
  it("rejects members", async () => {
    getIdentity.mockResolvedValue({
      userId: "member-1",
      authenticated: true,
      role: "member",
      groups: [],
    });
    const { PUT } = await import("@/app/api/settings/pricing/route");
    const res = await PUT(put({ reset: true }));
    expect(res.status).toBe(403);
    expect(savePricingRateOverrides).not.toHaveBeenCalled();
  });

  it("lets an Admin reset to published list rates", async () => {
    getIdentity.mockResolvedValue({
      userId: "admin-1",
      authenticated: true,
      role: "admin",
      groups: ["Admin"],
    });
    const { PUT } = await import("@/app/api/settings/pricing/route");
    const res = await PUT(put({ reset: true }));
    expect(res.status).toBe(200);
    expect(savePricingRateOverrides).toHaveBeenCalledWith({}, "admin-1");
  });
});
