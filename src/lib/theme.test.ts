/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyTheme,
  DEFAULT_THEME,
  hasSignedInHint,
  isThemePreference,
  readStoredTheme,
  setForcedDark,
  setSignedInHint,
  SIGNED_IN_HINT_KEY,
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

describe("dark login screen", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = "";
    setForcedDark(false);
  });

  afterEach(() => {
    setForcedDark(false);
    localStorage.clear();
  });

  it("shows dark while forced, and leaves the saved preference alone", () => {
    applyTheme("light");
    setForcedDark(true);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  it("brings the saved preference back when it is no longer forced", () => {
    applyTheme("light");
    setForcedDark(true);
    setForcedDark(false);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("keeps a theme change made while forced from being shown until sign-in", () => {
    setForcedDark(true);
    applyTheme("light");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    setForcedDark(false);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("remembers whether someone is signed in", () => {
    expect(hasSignedInHint()).toBe(false);
    setSignedInHint(true);
    expect(localStorage.getItem(SIGNED_IN_HINT_KEY)).toBe("1");
    expect(hasSignedInHint()).toBe(true);
    setSignedInHint(false);
    expect(hasSignedInHint()).toBe(false);
  });

  it("first paint is dark unless a signed-in hint exists", async () => {
    const { THEME_BOOT_SCRIPT } = await import("@/lib/theme");
    const run = () => {
      document.documentElement.className = "";
      new Function(THEME_BOOT_SCRIPT)();
      return document.documentElement.classList.contains("dark");
    };
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    expect(run()).toBe(true);
    localStorage.setItem(SIGNED_IN_HINT_KEY, "1");
    expect(run()).toBe(false);
  });
});
