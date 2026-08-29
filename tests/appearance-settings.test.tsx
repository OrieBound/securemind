/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppearanceSettings } from "@/components/app/appearance-settings";
import { ThemeProvider } from "@/components/app/theme-provider";
import { THEME_STORAGE_KEY } from "@/lib/theme";

function renderAppearance() {
  return render(
    <ThemeProvider>
      <AppearanceSettings />
    </ThemeProvider>,
  );
}

describe("AppearanceSettings", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.add("dark");
    document.documentElement.dataset.theme = "dark";
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("marks Dark as selected by default", () => {
    renderAppearance();
    const dark = screen.getByRole("radio", { name: /dark theme/i });
    const light = screen.getByRole("radio", { name: /light theme/i });
    expect(dark.getAttribute("aria-checked")).toBe("true");
    expect(light.getAttribute("aria-checked")).toBe("false");
  });

  it("switches to light immediately and persists", () => {
    renderAppearance();
    fireEvent.click(screen.getByRole("radio", { name: /light theme/i }));
    expect(screen.getByRole("radio", { name: /light theme/i }).getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  it("supports keyboard arrow switching", () => {
    renderAppearance();
    const dark = screen.getByRole("radio", { name: /dark theme/i });
    dark.focus();
    fireEvent.keyDown(dark, { key: "ArrowRight" });
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
