/**
 * A real sign-in is a fresh start: the app opens on its main page, not on whatever menu, settings
 * section or Insights view was open last time. A page reload while still signed in is not a sign-in
 * and keeps its place. The preferences people set on purpose (theme, sidebar widths, which workspace
 * was active) are left alone.
 */

/** Where the app remembers "the last place I was". Kept as plain strings so this stays tiny. */
export const REMEMBERED_PLACE_LOCAL_KEYS = ["sm_settings_section", "sm_insights_subject"] as const;
export const REMEMBERED_PLACE_SESSION_KEYS = ["sm_open_settings", "sm_pending_work_nav"] as const;

export function resetRememberedPlace(): void {
  try {
    for (const key of REMEMBERED_PLACE_LOCAL_KEYS) localStorage.removeItem(key);
    for (const key of REMEMBERED_PLACE_SESSION_KEYS) sessionStorage.removeItem(key);
  } catch {
    /* private browsing: nothing was remembered */
  }
}

/** Insights pages live at their own address. After signing in, start on the main page instead. */
export function shouldLeaveForMainPage(pathname: string): boolean {
  return pathname === "/analytics" || pathname.startsWith("/analytics/");
}
