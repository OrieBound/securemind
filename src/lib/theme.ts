/**
 * Appearance preference — dark is the product default.
 *
 * Applied as a class on <html> (`dark` | absent). A blocking script in the root
 * layout reads localStorage before paint so the first frame matches the saved
 * preference (no flash, no hydration mismatch when suppressHydrationWarning
 * is set on <html>).
 */

export type ThemePreference = "dark" | "light";

export const THEME_STORAGE_KEY = "sm_theme";
export const DEFAULT_THEME: ThemePreference = "dark";

export function isThemePreference(v: unknown): v is ThemePreference {
  return v === "dark" || v === "light";
}

/** Read the stored preference. Defaults to dark when unset or invalid. */
export function readStoredTheme(): ThemePreference {
  if (typeof window === "undefined") return DEFAULT_THEME;
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(raw) ? raw : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/**
 * While nobody is signed in the app always looks dark, whatever the saved preference says. The
 * preference itself is never changed by this: it comes back when someone signs in.
 */
let forcedDark = false;

function paintTheme(theme: ThemePreference): void {
  const shown: ThemePreference = forcedDark ? "dark" : theme;
  const root = document.documentElement;
  root.classList.toggle("dark", shown === "dark");
  root.dataset.theme = shown;
  root.style.colorScheme = shown;
}

/** Show dark (or the saved preference again) without writing anything to storage. */
export function setForcedDark(on: boolean): void {
  forcedDark = on;
  if (typeof document === "undefined") return;
  paintTheme(readStoredTheme());
}

/** Apply the theme to <html> and persist. Safe to call on the client only. */
export function applyTheme(theme: ThemePreference): void {
  paintTheme(theme);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* private browsing / quota */
  }
}

/**
 * Set while a person is signed in. The first paint reads it: without it nobody is known to be signed
 * in, so the page starts dark and the login screen never flashes light.
 */
export const SIGNED_IN_HINT_KEY = "sm_signed_in";

export function setSignedInHint(signedIn: boolean): void {
  try {
    if (signedIn) localStorage.setItem(SIGNED_IN_HINT_KEY, "1");
    else localStorage.removeItem(SIGNED_IN_HINT_KEY);
  } catch {
    /* private browsing / quota */
  }
}

export function hasSignedInHint(): boolean {
  try {
    return localStorage.getItem(SIGNED_IN_HINT_KEY) === "1";
  } catch {
    return false;
  }
}

/** JSON for an inline <script>: a literal `<` can never close the tag, and line separators stay escaped. */
function scriptSafeJson(value: string): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * Inline script source — must stay in sync with THEME_STORAGE_KEY / DEFAULT_THEME.
 * Runs before React hydrates.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var k=${scriptSafeJson(THEME_STORAGE_KEY)};var d=${scriptSafeJson(DEFAULT_THEME)};var t=localStorage.getItem(k);if(t!=="dark"&&t!=="light")t=d;if(localStorage.getItem(${scriptSafeJson(SIGNED_IN_HINT_KEY)})!=="1")t="dark";var r=document.documentElement;r.classList.toggle("dark",t==="dark");r.dataset.theme=t;r.style.colorScheme=t;}catch(e){document.documentElement.classList.add("dark");document.documentElement.dataset.theme="dark";document.documentElement.style.colorScheme="dark";}})();`;
