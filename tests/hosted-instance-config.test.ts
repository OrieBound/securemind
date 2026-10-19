import { describe, expect, it } from "vitest";
import {
  createHostedInstanceConfigStore,
  emptyInstanceConfigRow,
} from "@/lib/instance-config-hosted";
import { ATTR } from "@/lib/storage/dynamodb-schema";
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

  it("persists portal name, a cleared phrase, and the logo timestamp", async () => {
    const store = createHostedInstanceConfigStore(createMemoryDriver());
    const logoAt = new Date("2026-10-04T18:00:00.000Z");
    await store.merge({
      portalName: "Northwind",
      portalTagline: "",
      portalLogoAt: logoAt,
      updatedByUserId: "owner-1",
    });
    await store.merge({ allowRealAws: true, updatedByUserId: "owner-1" });
    const row = await store.get();
    expect(row?.portalName).toBe("Northwind");
    expect(row?.portalTagline).toBe("");
    expect(row?.portalLogoAt?.toISOString()).toBe(logoAt.toISOString());
    expect(row?.allowRealAws).toBe(true);
  });

  it("keeps an older config blob on the SecureMind portal defaults", async () => {
    const driver = createMemoryDriver();
    const store = createHostedInstanceConfigStore(driver);
    await driver.put("app#instance", "cfg#singleton", {
      [ATTR.userId]: { S: "instance" },
      [ATTR.category]: { S: "instance_config" },
      [ATTR.content]: {
        S: JSON.stringify({
          id: "singleton",
          primaryProvider: "auto",
          allowRealAws: false,
          piiSensitivity: "balanced",
          defaultMonthlyCostCapUsd: 10,
          updatedAt: "2026-08-01T00:00:00.000Z",
        }),
      },
    });
    const row = await store.get();
    expect(row?.portalName).toBeNull();
    expect(row?.portalTagline).toBeNull();
    expect(row?.portalLogoAt).toBeNull();
    expect(row?.allowRealAws).toBe(false);
  });
});
