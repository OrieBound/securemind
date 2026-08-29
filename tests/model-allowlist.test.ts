/**
 * A browser may express a model preference; the server decides what is allowed.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const getModelCatalogCached = vi.fn();

vi.mock("@/lib/models/catalog", () => ({
  getModelCatalogCached: (...args: unknown[]) => getModelCatalogCached(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
  getModelCatalogCached.mockResolvedValue({ groq: [], bedrock: [], ollama: [], errors: [] });
});

describe("resolveAllowedModel", () => {
  it("allows a model the router itself can select", async () => {
    const { resolveAllowedModel } = await import("@/lib/models/allowlist");
    const allowed = await resolveAllowedModel("openai/gpt-oss-120b");
    expect(allowed).toEqual({ model: "openai/gpt-oss-120b", provider: "groq" });
  });

  it("denies an arbitrary model id supplied by the client", async () => {
    const { resolveAllowedModel } = await import("@/lib/models/allowlist");
    expect(await resolveAllowedModel("attacker/expensive-model-v9")).toBeNull();
  });

  it("denies empty and whitespace ids", async () => {
    const { resolveAllowedModel } = await import("@/lib/models/allowlist");
    expect(await resolveAllowedModel("")).toBeNull();
    expect(await resolveAllowedModel("   ")).toBeNull();
    expect(await resolveAllowedModel(undefined)).toBeNull();
  });

  it("allows a text model present in the live catalog", async () => {
    getModelCatalogCached.mockResolvedValue({
      groq: [],
      bedrock: [
        {
          id: "anthropic.claude-3-5-haiku-20241022-v1:0",
          name: "Claude 3.5 Haiku",
          provider: "bedrock",
          modality: "text",
        },
      ],
      ollama: [],
      errors: [],
    });
    const { resolveAllowedModel } = await import("@/lib/models/allowlist");
    const allowed = await resolveAllowedModel("anthropic.claude-3-5-haiku-20241022-v1:0");
    expect(allowed?.provider).toBe("bedrock");
  });

  it("allows a vision-capable chat model present in the live catalog", async () => {
    getModelCatalogCached.mockResolvedValue({
      groq: [
        {
          id: "pixtral-12b-instruct",
          name: "Pixtral 12B",
          provider: "groq",
          modality: "vision",
        },
      ],
      bedrock: [],
      ollama: [],
      errors: [],
    });
    const { resolveAllowedModel } = await import("@/lib/models/allowlist");
    const allowed = await resolveAllowedModel("pixtral-12b-instruct");
    expect(allowed).toEqual({ model: "pixtral-12b-instruct", provider: "groq" });
  });

  it("denies a catalog model that cannot be used for chat", async () => {
    getModelCatalogCached.mockResolvedValue({
      groq: [
        {
          id: "canopylabs/orpheus-v1-english",
          name: "Orpheus TTS",
          provider: "groq",
          modality: "text",
        },
      ],
      bedrock: [],
      ollama: [],
      errors: [],
    });
    const { resolveAllowedModel } = await import("@/lib/models/allowlist");
    expect(await resolveAllowedModel("canopylabs/orpheus-v1-english")).toBeNull();
  });

  it("denies when the catalog lookup fails", async () => {
    getModelCatalogCached.mockRejectedValue(new Error("network down"));
    const { resolveAllowedModel } = await import("@/lib/models/allowlist");
    expect(await resolveAllowedModel("unknown/model")).toBeNull();
  });
});
