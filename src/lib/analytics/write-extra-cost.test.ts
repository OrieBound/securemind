import { beforeEach, describe, expect, it, vi } from "vitest";

const created = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>> }));

vi.mock("@/lib/db", () => ({
  db: {
    inferenceEvent: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.rows.push(data);
        return data;
      }),
    },
  },
}));
vi.mock("@/lib/workspaces/store", () => ({ usesHostedAppStore: () => false }));
vi.mock("@/lib/workspaces/hosted-dynamo", () => ({ hostedAppStore: () => ({}) }));
vi.mock("@/lib/pricing/rate-overrides-store", () => ({ getPricingRateOverrides: async () => ({}) }));

import { recordInferenceEvent } from "./write";

const base = {
  userId: "alice",
  provider: "groq",
  model: "llama-3.1-8b-instant",
  tier: "Light",
  status: "ok" as const,
  promptTokens: 1_000_000,
  completionTokens: 0,
};

beforeEach(() => {
  created.rows.length = 0;
});

describe("recordInferenceEvent extraCostUsd", () => {
  it("adds the tie-break cost to the turn's estimate", async () => {
    await recordInferenceEvent(base);
    await recordInferenceEvent({ ...base, extraCostUsd: 0.5 });
    const [plain, withExtra] = created.rows.map(r => r.estimatedCostUsd as number);
    expect(plain).toBeCloseTo(0.055, 6);
    expect(withExtra).toBeCloseTo(plain + 0.5, 6);
  });

  it("records the tie-break cost even when the reply reported no tokens", async () => {
    await recordInferenceEvent({ ...base, promptTokens: null, completionTokens: null, extraCostUsd: 0.0002 });
    expect(created.rows[0].estimatedCostUsd).toBeCloseTo(0.0002, 8);
  });

  it("ignores a zero, negative or non-finite extra cost", async () => {
    for (const extra of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      created.rows.length = 0;
      await recordInferenceEvent({ ...base, extraCostUsd: extra });
      expect(created.rows[0].estimatedCostUsd, String(extra)).toBeCloseTo(0.055, 6);
    }
  });

  it("does not create a separate event, so tier and request counts are unchanged", async () => {
    await recordInferenceEvent({ ...base, extraCostUsd: 0.001 });
    expect(created.rows).toHaveLength(1);
    expect(created.rows[0].tier).toBe("Light");
  });
});
