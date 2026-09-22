// @vitest-environment happy-dom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ComplexityTiersEditor, type ComplexityTiersEditorProps } from "@/components/app/complexity-tiers-editor";

afterEach(cleanup);
const props = (): ComplexityTiersEditorProps => ({
  variant: "rail", deployment: "docker", modelSelectionMode: "auto", onModelSelectionModeChange: vi.fn(),
  modeModelOverrides: { Plus: "old-cloud-model" }, onAssignTier: vi.fn(), fixedModelId: "old-cloud-model", onFixedModelIdChange: vi.fn(),
  lastRoute: null, chatCatalogModels: [{ id: "local-chat", name: "Local", provider: "ollama", modality: "text", verification: "installed" }],
  labelFor: id => id, providerFor: id => id === "local-chat" ? "ollama" : "groq", displayModelFor: tier => tier === "Plus" ? "old-cloud-model" : "local-chat",
  tierStatus: id => ({ ready: id === "local-chat", notForChat: false }),
  cloudDefaultsWillRun: false, groqCatalogReady: false, ollamaCatalogReady: true, bedrockCatalogReady: false, localFallbackModel: "local-chat",
});

describe("local tier assignments", () => {
  it("identifies Docker and lets the user replace stale cloud preferences with installed local models", () => {
    const p = props();
    render(<ComplexityTiersEditor {...p} />);
    expect(screen.getByText("Local · Docker")).toBeTruthy();
    expect(screen.queryByText("Not for chat")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Use local model for all tiers" }));
    expect(p.onAssignTier).toHaveBeenCalledTimes(5);
    for (const tier of ["Max", "Plus", "Standard", "Light", "Micro"]) expect(p.onAssignTier).toHaveBeenCalledWith(tier, "local-chat");
    expect(p.onModelSelectionModeChange).toHaveBeenCalledWith("auto");
  });
  it("does not offer a hidden or failed local model as a recovery option", () => {
    render(<ComplexityTiersEditor {...props()} chatCatalogModels={[]} />);
    expect(screen.queryByRole("button", { name: "Use local model for all tiers" })).toBeNull();
  });
});
