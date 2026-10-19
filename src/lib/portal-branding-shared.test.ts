import { describe, expect, it } from "vitest";
import { PRODUCT_CHROME_TAGLINE, PRODUCT_NAME } from "@/lib/branding";
import {
  PORTAL_NAME_MAX,
  PORTAL_TAGLINE_MAX,
  normalizePortalName,
  normalizePortalTagline,
  toPortalChrome,
} from "@/lib/portal-branding-shared";

describe("portal text limits", () => {
  it("accepts a name and phrase inside the sidebar limits", () => {
    expect(normalizePortalName("Northwind Security")).toEqual({
      ok: true,
      value: "Northwind Security",
    });
    expect(normalizePortalTagline("Clinical notes workspace")).toEqual({
      ok: true,
      value: "Clinical notes workspace",
    });
  });

  it("collapses a name onto one line", () => {
    expect(normalizePortalName("  Harbor\nLight  ")).toEqual({ ok: true, value: "Harbor Light" });
  });

  it("rejects an empty name and anything past the character caps", () => {
    expect(normalizePortalName("   ").ok).toBe(false);
    expect(normalizePortalName("A".repeat(PORTAL_NAME_MAX + 1)).ok).toBe(false);
    expect(normalizePortalTagline("B".repeat(PORTAL_TAGLINE_MAX + 1)).ok).toBe(false);
  });

  it("lets a blank phrase hide the line", () => {
    expect(normalizePortalTagline("   ")).toEqual({ ok: true, value: "" });
    expect(normalizePortalTagline(null)).toEqual({ ok: true, value: "" });
  });
});

describe("portal chrome resolution", () => {
  it("uses SecureMind when the instance has not customized the portal", () => {
    const chrome = toPortalChrome(null);
    expect(chrome.name).toBe(PRODUCT_NAME);
    expect(chrome.tagline).toBe(PRODUCT_CHROME_TAGLINE);
    expect(chrome.logoUrl).toBeNull();
    expect(chrome.isDefault).toBe(true);
  });

  it("hides the phrase when it was cleared and points at the stored logo", () => {
    const at = new Date("2026-10-04T18:00:00.000Z");
    const chrome = toPortalChrome({
      portalName: "Northwind",
      portalTagline: "",
      portalLogoAt: at,
    });
    expect(chrome.name).toBe("Northwind");
    expect(chrome.tagline).toBe("");
    expect(chrome.hasCustomLogo).toBe(true);
    expect(chrome.logoUrl).toBe(`/api/settings/portal/logo?v=${encodeURIComponent(at.toISOString())}`);
    expect(chrome.isDefault).toBe(false);
  });
});
