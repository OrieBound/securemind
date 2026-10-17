import { describe, expect, it } from "vitest";
import {
  listEditableRates,
  overridesFromEditedRows,
  parseRateOverrides,
} from "./rate-overrides";

describe("rate overrides", () => {
  it("parses sparse Admin overrides and ignores junk", () => {
    const map = parseRateOverrides({
      "bedrock:amazon.nova-lite-v1:0": { inputPerM: 0.1, outputPerM: 0.2 },
      "ollama:llama": { inputPerM: 1, outputPerM: 1 },
      bad: { inputPerM: -1, outputPerM: 1 },
    });
    expect(map).toEqual({
      "bedrock:amazon.nova-lite-v1:0": { inputPerM: 0.1, outputPerM: 0.2 },
    });
  });

  it("stores only diffs from the curated list tables", () => {
    const rows = listEditableRates({});
    const nova = rows.find(r => r.model === "amazon.nova-lite-v1:0");
    expect(nova?.source).toBe("list");
    const edited = rows.map(r =>
      r.model === "amazon.nova-lite-v1:0"
        ? { ...r, inputPerM: 0.5, outputPerM: 1 }
        : r,
    );
    const overrides = overridesFromEditedRows(edited);
    expect(overrides).toEqual({
      "bedrock:amazon.nova-lite-v1:0": { inputPerM: 0.5, outputPerM: 1 },
    });
  });

  it("shows a catalog model with no published rate as an editable floor", () => {
    const floor = { inputPerM: 0.59, outputPerM: 0.79 };
    const rows = listEditableRates({}, { groqModelIds: ["allam-2-7b"], floor });
    const allam = rows.find(r => r.model === "allam-2-7b");
    expect(allam?.source).toBe("floor");
    expect(allam?.inputPerM).toBe(0.59);
    const kept = overridesFromEditedRows(rows, floor);
    expect(kept["groq:allam-2-7b"]).toBeUndefined();
    const priced = overridesFromEditedRows(
      rows.map(r => r.model === "allam-2-7b" ? { ...r, inputPerM: 0.05, outputPerM: 0.08 } : r),
      floor,
    );
    expect(priced["groq:allam-2-7b"]).toEqual({ inputPerM: 0.05, outputPerM: 0.08 });
  });

  it("accepts vendor overrides and lists the curated vendor families", () => {
    const map = parseRateOverrides({
      "openai:GPT-4.1": { inputPerM: 1, outputPerM: 2 },
      "google:models/gemini-2.5-pro": { inputPerM: 1, outputPerM: 2 },
    });
    expect(Object.keys(map).sort()).toEqual(["google:gemini-2.5-pro", "openai:gpt-4.1"]);

    const rows = listEditableRates({});
    for (const provider of ["google", "openai", "anthropic", "xai"]) {
      expect(rows.some(r => r.provider === provider && r.source === "list")).toBe(true);
    }
  });

  it("does not store an untouched vendor row as an override", () => {
    const rows = listEditableRates({});
    expect(overridesFromEditedRows(rows)).toEqual({});
  });
});
