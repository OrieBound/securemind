/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyTheme,
  DEFAULT_THEME,
  isThemePreference,
  readStoredTheme,
  THEME_STORAGE_KEY,
} from "@/lib/theme";

describe("theme preference", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = "";
    delete document.documentElement.dataset.theme;
    document.documentElement.style.colorScheme = "";
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("defaults to dark when nothing is stored", () => {
    expect(DEFAULT_THEME).toBe("dark");
    expect(readStoredTheme()).toBe("dark");
  });

  it("accepts only dark and light", () => {
    expect(isThemePreference("dark")).toBe(true);
    expect(isThemePreference("light")).toBe(true);
    expect(isThemePreference("system")).toBe(false);
    expect(isThemePreference("")).toBe(false);
  });

  it("persists light and applies the class immediately", () => {
    applyTheme("light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.style.colorScheme).toBe("light");
    expect(readStoredTheme()).toBe("light");
  });

  it("switches back to dark", () => {
    applyTheme("light");
    applyTheme("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("ignores corrupt storage and falls back to dark", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "neon");
    expect(readStoredTheme()).toBe("dark");
  });

  it("boot script source includes the storage key and dark default", async () => {
    const { THEME_BOOT_SCRIPT } = await import("@/lib/theme");
    expect(THEME_BOOT_SCRIPT).toContain(THEME_STORAGE_KEY);
    expect(THEME_BOOT_SCRIPT).toContain("dark");
    expect(THEME_BOOT_SCRIPT).toContain("light");
  });
});

describe("applyTheme resilience", () => {
  it("still toggles the class when localStorage throws", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    applyTheme("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    spy.mockRestore();
  });
});
