import { describe, expect, it } from "vitest";
import type { CatalogModel } from "./catalog-shared";
import { planRecommendedBedrock, recommendedNeedingConsole } from "./bedrock-recommended";

const m = (id: string, extra: Partial<CatalogModel> = {}): CatalogModel => ({
  id,
  name: id,
  provider: "bedrock",
  modality: "text",
  ...extra,
});

describe("planRecommendedBedrock", () => {
  it("picks the newest version of each family first", () => {
    const plan = planRecommendedBedrock([
      m("us.anthropic.claude-3-haiku-20240307-v1:0"),
      m("us.anthropic.claude-haiku-4-5-20251001-v1:0"),
      m("us.amazon.nova-lite-v1:0"),
      m("us.amazon.nova-pro-v1:0"),
    ]);
    expect(plan.map(p => p.label)).toEqual(["Amazon Nova Lite", "Claude Haiku"]);
    expect(plan[1].candidates[0].id).toBe("us.anthropic.claude-haiku-4-5-20251001-v1:0");
    expect(plan[1].candidates[1].id).toBe("us.anthropic.claude-3-haiku-20240307-v1:0");
  });

  it("skips a family that already has a model in chat", () => {
    const plan = planRecommendedBedrock([
      m("us.amazon.nova-lite-v1:0", { verification: "verified" }),
      m("us.anthropic.claude-haiku-4-5-20251001-v1:0"),
    ]);
    expect(plan.map(p => p.label)).toEqual(["Claude Haiku"]);
  });

  it("leaves out hidden, failed and not-enabled models and other providers", () => {
    const plan = planRecommendedBedrock([
      m("us.amazon.nova-lite-v1:0", { access: "needs_enablement" }),
      m("us.anthropic.claude-haiku-4-5-20251001-v1:0", { hidden: true }),
      m("us.anthropic.claude-3-haiku-20240307-v1:0", { verification: "failed" }),
      { ...m("claude-haiku-direct"), provider: "anthropic" },
    ]);
    expect(plan).toEqual([]);
  });

  it("tries at most three versions per family", () => {
    const plan = planRecommendedBedrock([1, 2, 3, 4, 5].map(n => m(`us.anthropic.claude-haiku-${n}-v1:0`)));
    expect(plan[0].candidates).toHaveLength(3);
  });
});

describe("recommendedNeedingConsole", () => {
  it("names families the account lists but has not enabled", () => {
    expect(
      recommendedNeedingConsole([
        m("us.anthropic.claude-haiku-4-5-v1:0", { access: "needs_enablement" }),
        m("us.amazon.nova-lite-v1:0"),
      ]),
    ).toEqual(["Claude Haiku"]);
  });
});
