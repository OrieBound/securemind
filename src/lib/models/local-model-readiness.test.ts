import { afterEach, describe, expect, it, vi } from "vitest";
import { ollamaModelCapabilities } from "./ollama";
import { catalogSelectionStatus, withModelAvailability } from "./model-availability";
import { buildAssignmentPickerModels, buildChatPickerModels } from "@/components/app/model-catalog";
import { runtimeDeployment } from "@/lib/runtime-env";
import type { CatalogModel } from "./catalog-shared";

const local: CatalogModel = { id: "local-chat", name: "Local", provider: "ollama", modality: "text", verification: "installed" };
const empty = { groq: [], bedrock: [], ollama: [], openai: [], anthropic: [], google: [], xai: [] };
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("local model readiness", () => {
  it("offers an installed chat model without a manual test, but still excludes embeddings", () => {
    const ready = withModelAvailability(local, undefined, "local");
    const embedding = { ...local, id: "nomic-embed-text", modality: "other" as const };
    expect(buildChatPickerModels({ ...empty, ollama: [ready, embedding] }).map(m => m.id)).toEqual([local.id]);
    expect(catalogSelectionStatus(ready)).toMatchObject({ ready: true, notForChat: false });
  });
  it("honors hidden models and a recent failed test even when installed", () => {
    const hidden = withModelAvailability(local, { hidden: true }, "local");
    const failed = withModelAvailability(local, { verification: { ok: false, checkedAt: new Date().toISOString(), scope: "local" } }, "local");
    expect(buildChatPickerModels({ ...empty, ollama: [hidden, failed] })).toEqual([]);
    expect(catalogSelectionStatus(hidden).label).toBe("Hidden");
    expect(catalogSelectionStatus(failed)).toMatchObject({ notForChat: false, label: "Check failed" });
  });
  it("keeps a hidden local model in the tier picker so the provider filter can list it", () => {
    const hidden = withModelAvailability(local, { hidden: true }, "local");
    const gemini = withModelAvailability(
      { id: "gemini-3-flash-preview", name: "Gemini", provider: "google", modality: "text" },
      { verification: { ok: true, checkedAt: new Date().toISOString(), scope: "key" } },
      "key",
    );
    const failed = withModelAvailability(
      { id: "gemini-failed", name: "Failed", provider: "google", modality: "text" },
      { verification: { ok: false, checkedAt: new Date().toISOString(), scope: "key" } },
      "key",
    );
    expect(buildChatPickerModels({ ...empty, ollama: [hidden], google: [gemini, failed] }).map(m => m.id)).toEqual([gemini.id]);
    expect(buildAssignmentPickerModels({ ...empty, ollama: [hidden], google: [gemini, failed] }).map(m => m.id)).toEqual([
      gemini.id,
      hidden.id,
    ]);
  });
  it("keeps an untested cloud model out of menus", () => {
    const cloud = withModelAvailability({ ...local, provider: "google" }, undefined, "key");
    expect(buildChatPickerModels({ ...empty, google: [cloud] })).toEqual([]);
    expect(catalogSelectionStatus(cloud)).toMatchObject({ ready: false, notForChat: false, label: "Not in menus" });
  });
  it("inspects capabilities using show, without pulling weights or generating text", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ capabilities: ["completion", "tools"] }));
    vi.stubGlobal("fetch", fetch);
    expect(await ollamaModelCapabilities("local-chat")).toEqual(["completion", "tools"]);
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][0]).toMatch(/\/api\/show$/);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ model: "local-chat" });
  });
  it("leaves unreachable or older models unconfirmed", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await ollamaModelCapabilities("local-chat")).toBeNull();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ details: {} })));
    expect(await ollamaModelCapabilities("local-chat")).toBeNull();
  });
  it("distinguishes Docker, direct local execution, and hosted deployments", () => {
    vi.stubEnv("SECUREMIND_EDITION", "local");
    vi.stubEnv("SECUREMIND_RUNTIME", "docker");
    expect(runtimeDeployment()).toBe("docker");
    vi.stubEnv("SECUREMIND_RUNTIME", "");
    expect(runtimeDeployment()).toBe("host");
    vi.stubEnv("SECUREMIND_RUNTIME", "docker");
    vi.stubEnv("SECUREMIND_EDITION", "cloud");
    expect(runtimeDeployment()).toBe("hosted");
  });
});
