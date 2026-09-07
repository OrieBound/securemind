import { afterEach, describe, expect, it } from "vitest";
import {
  clearBedrockNotEntitledForTests,
  isBedrockIdDenied,
  rememberBedrockNotEntitled,
} from "./bedrock-denylist";
import { uniqueFoundationModelIds, type BedrockCatalogCandidate } from "./bedrock-catalog";

describe("bedrock denylist", () => {
  afterEach(() => clearBedrockNotEntitledForTests());

  it("treats a profile id and its foundation id as the same denial", () => {
    rememberBedrockNotEntitled("anthropic.claude-opus-5");
    expect(isBedrockIdDenied("anthropic.claude-opus-5")).toBe(true);
    expect(isBedrockIdDenied("us.anthropic.claude-opus-5", "anthropic.claude-opus-5")).toBe(true);
  });
});

describe("uniqueFoundationModelIds", () => {
  it("dedupes foundation ids across inference profiles", () => {
    const candidates: BedrockCatalogCandidate[] = [
      {
        foundationModelId: "anthropic.claude-sonnet-4-5-20250929-v1:0",
        model: {
          id: "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
          name: "Sonnet",
          provider: "bedrock",
          modality: "text",
        },
      },
      {
        foundationModelId: "anthropic.claude-sonnet-4-5-20250929-v1:0",
        model: {
          id: "global.anthropic.claude-sonnet-4-5-20250929-v1:0",
          name: "Sonnet global",
          provider: "bedrock",
          modality: "text",
        },
      },
    ];
    expect(uniqueFoundationModelIds(candidates)).toEqual([
      "anthropic.claude-sonnet-4-5-20250929-v1:0",
    ]);
  });
});
