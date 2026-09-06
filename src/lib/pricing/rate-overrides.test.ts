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
});
