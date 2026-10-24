/**
 * @vitest-environment happy-dom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComplexityTiersEditor, type ComplexityTiersBind } from "@/components/app/complexity-tiers-editor";

afterEach(cleanup);

function bind(over: Partial<ComplexityTiersBind>): ComplexityTiersBind {
  return {
    deployment: undefined,
    modelSelectionMode: "auto",
    onModelSelectionModeChange: vi.fn(),
    modeModelOverrides: {},
    onAssignTier: vi.fn(),
    fixedModelId: "",
    onFixedModelIdChange: vi.fn(),
    lastRoute: null,
    chatCatalogModels: [],
    labelFor: id => id,
    providerFor: () => "google",
    displayModelFor: () => "gemini-test",
    tierStatus: () => ({ ready: false }),
    cloudDefaultsWillRun: false,
    groqCatalogReady: false,
    ollamaCatalogReady: false,
    bedrockCatalogReady: false,
    localFallbackModel: null,
    ...over,
  } as ComplexityTiersBind;
}

describe("model list while it is still connecting", () => {
  it("says it is connecting, not 'not set up' or 'no model'", () => {
    render(<ComplexityTiersEditor variant="rail" {...bind({ catalogPending: true })} />);
    expect(screen.getByText("Connecting to your models…")).toBeTruthy();
    expect(screen.getAllByText("Checking…").length).toBeGreaterThan(0);
    expect(screen.queryByText(/not set up/i)).toBeNull();
    expect(screen.queryByText(/No cloud or local chat model/)).toBeNull();
  });

  it("shows the real status once the list has answered", () => {
    render(<ComplexityTiersEditor variant="rail" {...bind({ catalogPending: false })} />);
    expect(screen.queryByText("Connecting to your models…")).toBeNull();
    expect(screen.getAllByText(/not set up/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/No cloud or local chat model/)).toBeTruthy();
  });
});
