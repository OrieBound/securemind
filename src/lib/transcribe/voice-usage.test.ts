import { beforeEach, describe, expect, it, vi } from "vitest";

const cap = { capped: false };
const recordInferenceEvent = vi.fn(async () => {});
vi.mock("@/lib/cost-cap", () => ({
  getUserCostCapStatus: async () => ({ capped: cap.capped, spentUsd: 5, capUsd: 5, resetsAt: "x", warningLevel: null }),
}));
vi.mock("@/lib/analytics/write", () => ({
  recordInferenceEvent: (...a: unknown[]) => recordInferenceEvent(...(a as [])),
}));

import { TRANSCRIBE_USD_PER_MINUTE, recordTranscribeUsage, voiceCostCapResponse } from "./voice-usage";

beforeEach(() => {
  vi.clearAllMocks();
  cap.capped = false;
});

describe("voiceCostCapResponse", () => {
  it("lets the request through under the cap", async () => {
    expect(await voiceCostCapResponse("u")).toBeNull();
  });
  it("answers 402 with the cap code once over it", async () => {
    cap.capped = true;
    const res = (await voiceCostCapResponse("u"))!;
    expect(res.status).toBe(402);
    expect((await res.json()).code).toBe("cost_cap_exceeded");
  });
});

describe("recordTranscribeUsage", () => {
  it("records minutes at the list rate", async () => {
    await recordTranscribeUsage("u", 2.5, "amazon-transcribe");
    const ev = (recordInferenceEvent.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(ev.extraCostUsd).toBeCloseTo(2.5 * TRANSCRIBE_USD_PER_MINUTE);
  });
  it("records nothing for zero or invalid lengths", async () => {
    for (const m of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) await recordTranscribeUsage("u", m, "x");
    expect(recordInferenceEvent).not.toHaveBeenCalled();
  });
  it("never throws when the write fails", async () => {
    recordInferenceEvent.mockRejectedValueOnce(new Error("db down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(recordTranscribeUsage("u", 1, "x")).resolves.toBeUndefined();
    warn.mockRestore();
  });
});
