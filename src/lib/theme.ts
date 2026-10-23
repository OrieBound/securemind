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

/** Apply the theme to <html> and persist. Safe to call on the client only. */
export function applyTheme(theme: ThemePreference): void {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* private browsing / quota */
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
export const THEME_BOOT_SCRIPT = `(function(){try{var k=${scriptSafeJson(THEME_STORAGE_KEY)};var d=${scriptSafeJson(DEFAULT_THEME)};var t=localStorage.getItem(k);if(t!=="dark"&&t!=="light")t=d;var r=document.documentElement;r.classList.toggle("dark",t==="dark");r.dataset.theme=t;r.style.colorScheme=t;}catch(e){document.documentElement.classList.add("dark");document.documentElement.dataset.theme="dark";document.documentElement.style.colorScheme="dark";}})();`;
