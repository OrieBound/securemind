import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ModelInventory } from "@/components/app/model-inventory";
import { BedrockEnvironmentCard } from "@/components/app/inference-settings";
import type { CatalogModel } from "@/lib/models/catalog-shared";

const mk = (id: string, name: string, provider: CatalogModel["provider"], extra: Partial<CatalogModel> = {}): CatalogModel => ({
  id, name, provider, modality: "text", ...extra,
});
const AWS_URL = "https://console.aws.amazon.com/bedrock/home?region=us-east-1#/model-catalog";

function inventory(models: CatalogModel[], view?: "chat" | "add" | "broken" | "hidden" | null) {
  return renderToStaticMarkup(createElement(ModelInventory, {
    models, complexityTiers: null, emptyLabel: "none", onTest: () => {}, awsEnableUrl: AWS_URL,
    onEnableRecommendedBedrock: () => {}, recommendedBedrock: { available: true, busy: false, message: null },
    view,
  }));
}

const MODELS = [
  mk("claude-haiku-4-5", "Claude Haiku 4.5", "anthropic", { verification: "verified" }),
  mk("us.amazon.nova-lite-v1:0", "Amazon Nova Lite", "bedrock"),
  mk("us.anthropic.claude-opus-4-5-v1:0", "Claude Opus 4.5", "bedrock", { access: "needs_enablement" }),
  mk("old-model", "Old model", "openai", { verification: "failed" }),
];

describe("Models list tabs", () => {
  it("shows the four tabs with counts and starts on In chat when something is in chat", () => {
    const html = inventory(MODELS);
    for (const label of ["In chat", "Add more", "Not working"]) expect(html).toContain(label);
    expect(html).toContain('id="models-panel-chat"');
    expect(html).not.toContain("Choose from all");
  });

  it("starts on Add more when nothing is in chat yet", () => {
    const html = inventory(MODELS.filter(m => m.verification !== "verified"));
    expect(html).toContain('id="models-panel-add"');
  });

  it("Add more explains Enable, offers the recommended button and the AWS link", () => {
    const html = inventory(MODELS, "add");
    expect(html).toContain("Press");
    expect(html).toContain("Enable recommended Bedrock models");
    expect(html).toContain("Open the Bedrock model catalog in AWS");
    expect(html).toContain(AWS_URL.replace(/&/g, "&amp;"));
    expect(html).toContain("Turn on in AWS");
  });

  it("verified models offer Re-check, not Test", () => {
    const html = inventory(MODELS, "chat");
    expect(html).toContain("Re-check");
    expect(html).not.toContain(">Test<");
  });

  it("Not working says why and what to do", () => {
    const html = inventory(MODELS, "broken");
    expect(html).toContain("did not answer");
    expect(html).toContain("Old model");
  });
});

describe("Bedrock card steps", () => {
  it("lays out allow, turn on in AWS, add to chat, with a region link", () => {
    const html = renderToStaticMarkup(createElement(BedrockEnvironmentCard, {
      aws: {
        allowRealAws: true, lockedByEnvironment: false, detected: true, looksLikeFloci: false, source: "env",
        profile: null, hint: null, availableProfiles: [], caller: { accountId: "123456789012" },
      } as never,
      region: "us-east-1", canEdit: true, busy: false, hosted: true, embedded: true,
      consoleUrl: AWS_URL, onReviewModels: () => {}, onSave: async () => {}, onRecheck: async () => {},
    }));
    expect(html).toContain("Allow Bedrock in SecureMind");
    expect(html).toContain("Turn the models on in your AWS account");
    expect(html).toContain("Add them to chat");
    expect(html).toContain("Open the Bedrock model catalog in AWS");
    expect(html).toContain("Go to Add more");
  });
});
