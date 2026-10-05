/**
 * Sidebar portal identity. Pure helpers — safe for the browser and the server.
 * SecureMind stays the product name everywhere except this chrome.
 */

import { PRODUCT_CHROME_TAGLINE, PRODUCT_NAME } from "@/lib/branding";

export const PORTAL_NAME_MAX = 22;
export const PORTAL_TAGLINE_MAX = 28;

export type PortalChromeSource = {
  portalName?: string | null;
  portalTagline?: string | null;
  portalLogoAt?: Date | null;
} | null;

export type PortalChrome = {
  name: string;
  /** Empty string hides the line under the name. */
  tagline: string;
  hasCustomLogo: boolean;
  logoUrl: string | null;
  isDefault: boolean;
  limits: { name: number; tagline: number };
};

export const PORTAL_LIMITS = { name: PORTAL_NAME_MAX, tagline: PORTAL_TAGLINE_MAX } as const;

export function defaultPortalChrome(): PortalChrome {
  return {
    name: PRODUCT_NAME,
    tagline: PRODUCT_CHROME_TAGLINE,
    hasCustomLogo: false,
    logoUrl: null,
    isDefault: true,
    limits: PORTAL_LIMITS,
  };
}

export type PortalTextResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

function singleLine(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

export function normalizePortalName(raw: unknown): PortalTextResult {
  if (typeof raw !== "string") {
    return { ok: false, error: "Enter a portal name." };
  }
  const value = singleLine(raw);
  if (!value) return { ok: false, error: "Enter a portal name." };
  if (value.length > PORTAL_NAME_MAX) {
    return { ok: false, error: `Name must be ${PORTAL_NAME_MAX} characters or fewer.` };
  }
  return { ok: true, value };
}

export function normalizePortalTagline(raw: unknown): PortalTextResult {
  if (raw == null) return { ok: true, value: "" };
  if (typeof raw !== "string") {
    return { ok: false, error: "Phrase must be text." };
  }
  const value = singleLine(raw);
  if (value.length > PORTAL_TAGLINE_MAX) {
    return { ok: false, error: `Phrase must be ${PORTAL_TAGLINE_MAX} characters or fewer.` };
  }
  return { ok: true, value };
}

export function toPortalChrome(row: PortalChromeSource): PortalChrome {
  const name = row?.portalName?.trim() || PRODUCT_NAME;
  let tagline = PRODUCT_CHROME_TAGLINE;
  let taglineUnset = true;
  if (row && row.portalTagline != null) {
    tagline = row.portalTagline.trim();
    taglineUnset = false;
  }
  const hasCustomLogo = Boolean(row?.portalLogoAt);
  const logoUrl = hasCustomLogo && row?.portalLogoAt
    ? `/api/settings/portal/logo?v=${encodeURIComponent(row.portalLogoAt.toISOString())}`
    : null;
  return {
    name,
    tagline,
    hasCustomLogo,
    logoUrl,
    isDefault: !row?.portalName?.trim() && taglineUnset && !hasCustomLogo,
    limits: PORTAL_LIMITS,
  };
}
