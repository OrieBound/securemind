import { describe, expect, it } from "vitest";
import {
  createHostedInstanceConfigStore,
  emptyInstanceConfigRow,
} from "@/lib/instance-config-hosted";
import { createMemoryDriver } from "@/lib/workspaces/hosted-dynamo";

describe("hosted instance config", () => {
  it("persists the Bedrock billing acknowledgement", async () => {
    const store = createHostedInstanceConfigStore(createMemoryDriver());
    expect(await store.get()).toBeNull();

    await store.merge({ allowRealAws: true, updatedByUserId: "owner-1" });
    const row = await store.get();
    expect(row?.allowRealAws).toBe(true);
    expect(row?.updatedByUserId).toBe("owner-1");
    expect(row?.id).toBe("singleton");
  });

  it("ensure creates a default row once", async () => {
    const store = createHostedInstanceConfigStore(createMemoryDriver());
    const a = await store.ensure();
    const b = await store.ensure();
    expect(a.id).toBe("singleton");
    expect(a.allowRealAws).toBe(false);
    expect(b.allowRealAws).toBe(false);
    expect(emptyInstanceConfigRow().storageBackend).toBe("dynamodb");
    expect(emptyInstanceConfigRow().voiceSttChoice).toBeNull();
    expect(emptyInstanceConfigRow().pricingRateOverrides).toBeNull();
  });

  it("persists list-rate overrides on the hosted config blob", async () => {
    const store = createHostedInstanceConfigStore(createMemoryDriver());
    await store.merge({
      pricingRateOverrides: {
        "bedrock:amazon.nova-lite-v1:0": { inputPerM: 0.1, outputPerM: 0.2 },
      },
      updatedByUserId: "owner-1",
    });
    const row = await store.get();
    expect(row?.pricingRateOverrides).toEqual({
      "bedrock:amazon.nova-lite-v1:0": { inputPerM: 0.1, outputPerM: 0.2 },
    });
  });

  it("persists an opt-in transcription choice", async () => {
    const store = createHostedInstanceConfigStore(createMemoryDriver());
    await store.merge({
      voiceSttChoice: "groq",
      voiceSttAudioAckAt: new Date("2026-08-30T00:00:00.000Z"),
      updatedByUserId: "owner-1",
    });
    const row = await store.get();
    expect(row?.voiceSttChoice).toBe("groq");
    expect(row?.voiceSttAudioAckAt?.toISOString()).toBe("2026-08-30T00:00:00.000Z");
  });
});
