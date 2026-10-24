/**
 * How long the "Take the tour" button stays in the header.
 *
 * It shows for an account's first few visits in this browser, then goes away on its own. Someone who
 * does not want it sooner can close it with the X. The tour itself stays available from the account
 * menu either way. A visit is one browser session (a tab or window), not a page reload.
 */

const KEY_PREFIX = "sm_tour_btn_v1:";
const COUNTED_KEY = "sm_tour_btn_counted";

export const TOUR_BUTTON_VISITS = 3;

type Stored = { visits: number; hidden: boolean };

export function tourButtonKey(account: string): string {
  return `${KEY_PREFIX}${account.trim().toLowerCase() || "local"}`;
}

export function parseStored(raw: string | null): Stored {
  try {
    const v = raw ? (JSON.parse(raw) as Partial<Stored>) : {};
    return {
      visits: typeof v.visits === "number" && v.visits >= 0 ? Math.floor(v.visits) : 0,
      hidden: v.hidden === true,
    };
  } catch {
    return { visits: 0, hidden: false };
  }
}

export function shouldShowTourButton(state: Stored): boolean {
  return !state.hidden && state.visits <= TOUR_BUTTON_VISITS;
}

/** Count this visit once per browser session and say whether the button should show. */
export function registerVisit(account: string): boolean {
  try {
    const key = tourButtonKey(account);
    const state = parseStored(localStorage.getItem(key));
    if (!sessionStorage.getItem(`${COUNTED_KEY}:${key}`)) {
      sessionStorage.setItem(`${COUNTED_KEY}:${key}`, "1");
      state.visits += 1;
      localStorage.setItem(key, JSON.stringify(state));
    }
    return shouldShowTourButton(state);
  } catch {
    // Storage blocked: showing it every time would nag, so hide it.
    return false;
  }
}

export function hideTourButton(account: string): void {
  try {
    const key = tourButtonKey(account);
    const state = parseStored(localStorage.getItem(key));
    localStorage.setItem(key, JSON.stringify({ ...state, hidden: true }));
  } catch {
    /* nothing to remember it with */
  }
}
