import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  parseVendorKeyBundle,
  readVendorKeyBundle,
  resetVendorKeyStoreForTests,
  writeVendorKeyBundle,
} from "@/lib/vendor-key-store";
import {
  createHostedInstanceConfigStore,
} from "@/lib/instance-config-hosted";
import { createMemoryDriver } from "@/lib/workspaces/hosted-dynamo";

describe("parseVendorKeyBundle", () => {
  it("reads a Groq key and extra keys", () => {
    expect(
      parseVendorKeyBundle({
        groqApiKey: "gsk_test",
        extra: [{ id: "1", kind: "openai", label: "OpenAI", secret: "sk-test" }],
      }),
    ).toEqual({
      groqApiKey: "gsk_test",
      extra: [
        expect.objectContaining({ id: "1", kind: "openai", secret: "sk-test" }),
      ],
    });
  });

  it("treats empty groq as absent", () => {
    expect(parseVendorKeyBundle({ groqApiKey: null, extra: [] })).toEqual({
      groqApiKey: null,
      extra: [],
    });
  });
});

describe("hosted vendor key memory store", () => {
  const prevEdition = process.env.SECUREMIND_EDITION;

  beforeEach(() => {
    process.env.SECUREMIND_EDITION = "cloud";
    resetVendorKeyStoreForTests({ groqApiKey: null, extra: [] });
  });

  afterEach(() => {
    resetVendorKeyStoreForTests();
    if (prevEdition === undefined) delete process.env.SECUREMIND_EDITION;
    else process.env.SECUREMIND_EDITION = prevEdition;
  });

  it("round-trips a Groq key without putting it in Dynamo", async () => {
    await writeVendorKeyBundle({ groqApiKey: "gsk_from_ui", extra: [] });
    const read = await readVendorKeyBundle();
    expect(read.groqApiKey).toBe("gsk_from_ui");

    const store = createHostedInstanceConfigStore(createMemoryDriver());
    await store.merge({ groqApiKey: "gsk_must_not_persist", updatedByUserId: "admin-1" });
    const row = await store.get();
    expect(row?.groqApiKey).toBeNull();
  });
});
