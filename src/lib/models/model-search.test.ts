import { describe, expect, it } from "vitest";
import {
  compareModelsForQuery,
  matchesModelQuery,
  modelPickerHint,
  modelQueryRank,
} from "./model-search";

const nova = {
  id: "us.amazon.nova-2-lite-v1:0",
  name: "Amazon Nova 2 Lite",
  provider: "bedrock" as const,
  note: "Cross-region inference profile",
};

const novaGlobal = {
  id: "global.amazon.nova-2-lite-v1:0",
  name: "Amazon Nova 2 Lite",
  provider: "bedrock" as const,
  note: "Cross-region inference profile",
};

const claude = {
  id: "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
  name: "Anthropic Claude Sonnet 4.5",
  provider: "bedrock" as const,
  note: "Cross-region inference profile",
};

const llama = {
  id: "llama-3.1-8b-instant",
  name: "Llama 3.1 8B Instant",
  provider: "groq" as const,
};

describe("matchesModelQuery", () => {
  it("matches friendly name and id substrings", () => {
    expect(matchesModelQuery(nova, "nova")).toBe(true);
    expect(matchesModelQuery(nova, "Nova 2")).toBe(true);
    expect(matchesModelQuery(nova, "lite")).toBe(true);
    expect(matchesModelQuery(claude, "claude")).toBe(true);
    expect(matchesModelQuery(claude, "cla")).toBe(true);
    expect(matchesModelQuery(nova, "nova-2-lite")).toBe(true);
  });

  it("does not treat a Claude prefix as every Bedrock model", () => {
    expect(matchesModelQuery(nova, "cla")).toBe(false);
    expect(matchesModelQuery(nova, "claude")).toBe(false);
    expect(matchesModelQuery(claude, "nova")).toBe(false);
  });

  it("still lists a whole vendor from a vendor word", () => {
    expect(matchesModelQuery(nova, "bedrock")).toBe(true);
    expect(matchesModelQuery(claude, "amazon")).toBe(true);
    expect(matchesModelQuery(llama, "groq")).toBe(true);
    expect(matchesModelQuery(llama, "bedrock")).toBe(false);
  });

  it("requires every token to match (name AND id style queries)", () => {
    expect(matchesModelQuery(nova, "nova lite")).toBe(true);
    expect(matchesModelQuery(nova, "nova sonnet")).toBe(false);
  });
});

describe("modelQueryRank", () => {
  it("prefers display-name hits over id-only", () => {
    expect(modelQueryRank(claude, "claude")).toBeGreaterThan(modelQueryRank(claude, "anthropic.claude"));
    expect(compareModelsForQuery(claude, nova, "cla")).toBeLessThan(0);
  });
});

describe("modelPickerHint", () => {
  it("shows a geo qualifier instead of the raw profile id", () => {
    expect(modelPickerHint(nova)).toBe("US");
    expect(modelPickerHint(novaGlobal)).toBe("Global");
    expect(modelPickerHint(llama)).toBeNull();
  });
});
