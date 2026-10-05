/** Browser signal so the sidebar refreshes after an admin saves the portal. */

export const PORTAL_BRANDING_EVENT = "sm-portal-branding";

export function notifyPortalBrandingChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(PORTAL_BRANDING_EVENT));
}
