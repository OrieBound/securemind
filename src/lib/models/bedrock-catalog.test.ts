import { describe, expect, it } from "vitest";
import {
  applyBedrockAvailability,
  foundationModelIdFromArn,
  isBedrockModelAvailable,
  selectInvocableBedrockModels,
} from "./bedrock-catalog";

const SONNET_ARN =
  "arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-sonnet-4-5-20250929-v1:0";
const SONNET_PROFILE = "us.anthropic.claude-sonnet-4-5-20250929-v1:0";

describe("bedrock-catalog", () => {
  it("extracts the foundation model id from an ARN", () => {
    expect(foundationModelIdFromArn(SONNET_ARN)).toBe(
      "anthropic.claude-sonnet-4-5-20250929-v1:0",
    );
  });

  it("prefers the inference profile over a raw ON_DEMAND alias", () => {
    const selected = selectInvocableBedrockModels(
      [
        {
          modelId: "anthropic.claude-sonnet-5",
          modelArn: SONNET_ARN,
          modelName: "Claude Sonnet 4.5",
          providerName: "Anthropic",
          responseStreamingSupported: true,
          inferenceTypesSupported: ["ON_DEMAND", "INFERENCE_PROFILE"],
          modelLifecycle: { status: "ACTIVE" },
        },
      ],
      [
        {
          inferenceProfileId: SONNET_PROFILE,
          inferenceProfileName: "US Anthropic Claude Sonnet 4.5",
          status: "ACTIVE",
          type: "SYSTEM_DEFINED",
          models: [{ modelArn: SONNET_ARN }],
        },
      ],
    );
    expect(selected.map(c => c.model.id)).toEqual([SONNET_PROFILE]);
    expect(selected[0]?.foundationModelId).toBe("anthropic.claude-sonnet-4-5-20250929-v1:0");
  });

  it("keeps ON_DEMAND ids when no inference profile exists", () => {
    const selected = selectInvocableBedrockModels(
      [
        {
          modelId: "amazon.nova-micro-v1:0",
          modelArn: "arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-micro-v1:0",
          modelName: "Nova Micro",
          providerName: "Amazon",
          responseStreamingSupported: true,
          inferenceTypesSupported: ["ON_DEMAND"],
          modelLifecycle: { status: "ACTIVE" },
        },
      ],
      [],
    );
    expect(selected.map(c => c.model.id)).toEqual(["amazon.nova-micro-v1:0"]);
  });

  it("drops LEGACY models and non-streaming models", () => {
    const selected = selectInvocableBedrockModels(
      [
        {
          modelId: "anthropic.claude-v2",
          responseStreamingSupported: true,
          inferenceTypesSupported: ["ON_DEMAND"],
          modelLifecycle: { status: "LEGACY" },
        },
        {
          modelId: "amazon.titan-embed-text-v2:0",
          responseStreamingSupported: false,
          inferenceTypesSupported: ["ON_DEMAND"],
          modelLifecycle: { status: "ACTIVE" },
        },
      ],
      [],
    );
    expect(selected).toEqual([]);
  });

  it("adds unmatched system inference profiles (e.g. global Nova)", () => {
    const selected = selectInvocableBedrockModels(
      [],
      [
        {
          inferenceProfileId: "global.amazon.nova-2-lite-v1:0",
          inferenceProfileName: "Nova 2 Lite",
          status: "ACTIVE",
          type: "SYSTEM_DEFINED",
          models: [
            { modelArn: "arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-2-lite-v1:0" },
          ],
        },
      ],
    );
    expect(selected.map(c => c.model.id)).toEqual(["global.amazon.nova-2-lite-v1:0"]);
    expect(selected[0]?.foundationModelId).toBe("amazon.nova-2-lite-v1:0");
  });

  it("treats missing agreement or authorization as not available", () => {
    expect(
      isBedrockModelAvailable({
        authorizationStatus: "NOT_AUTHORIZED",
        entitlementAvailability: "AVAILABLE",
        regionAvailability: "AVAILABLE",
      }),
    ).toBe(false);
    expect(
      isBedrockModelAvailable({
        authorizationStatus: "AUTHORIZED",
        entitlementAvailability: "AVAILABLE",
        regionAvailability: "AVAILABLE",
        agreementStatus: "NOT_AVAILABLE",
      }),
    ).toBe(false);
    expect(
      isBedrockModelAvailable({
        authorizationStatus: "AUTHORIZED",
        entitlementAvailability: "AVAILABLE",
        regionAvailability: "AVAILABLE",
        agreementStatus: "AVAILABLE",
      }),
    ).toBe(true);
  });

  it("drops models the availability probe says this account cannot use", () => {
    const candidates = selectInvocableBedrockModels(
      [
        {
          modelId: "anthropic.claude-sonnet-5",
          modelName: "Claude Sonnet 5",
          providerName: "Anthropic",
          responseStreamingSupported: true,
          inferenceTypesSupported: ["ON_DEMAND"],
          modelLifecycle: { status: "ACTIVE" },
        },
        {
          modelId: "amazon.nova-micro-v1:0",
          modelName: "Nova Micro",
          providerName: "Amazon",
          responseStreamingSupported: true,
          inferenceTypesSupported: ["ON_DEMAND"],
          modelLifecycle: { status: "ACTIVE" },
        },
      ],
      [],
    );
    const availability = new Map([
      [
        "anthropic.claude-sonnet-5",
        {
          authorizationStatus: "AUTHORIZED",
          entitlementAvailability: "NOT_AVAILABLE",
          regionAvailability: "AVAILABLE",
        },
      ],
      [
        "amazon.nova-micro-v1:0",
        {
          authorizationStatus: "AUTHORIZED",
          entitlementAvailability: "AVAILABLE",
          regionAvailability: "AVAILABLE",
        },
      ],
    ] as const);
    expect(applyBedrockAvailability(candidates, new Map(availability)).map(m => m.id)).toEqual([
      "amazon.nova-micro-v1:0",
    ]);
  });

  it("keeps models when availability was not probed", () => {
    const candidates = selectInvocableBedrockModels(
      [
        {
          modelId: "amazon.nova-micro-v1:0",
          responseStreamingSupported: true,
          inferenceTypesSupported: ["ON_DEMAND"],
          modelLifecycle: { status: "ACTIVE" },
        },
      ],
      [],
    );
    expect(applyBedrockAvailability(candidates, new Map()).map(m => m.id)).toEqual([
      "amazon.nova-micro-v1:0",
    ]);
  });
});
