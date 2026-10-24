/**
 * When to remind someone to turn on two-step verification.
 *
 * The reminder is a banner, not a blocking dialog. Dismissing it snoozes it: three days for Admins
 * (their accounts can change people, keys and settings) and a week for everyone else. Turning
 * two-step on removes it for good. The snooze is kept per account in this browser.
 */

const KEY_PREFIX = "sm_mfa_nudge:";
const DAY_MS = 24 * 60 * 60 * 1000;

export const MFA_CHANGED_EVENT = "sm-mfa-changed";

export function nudgeStorageKey(account: string): string {
  return `${KEY_PREFIX}${account.trim().toLowerCase() || "local"}`;
}

export function snoozeDays(isAdmin: boolean): number {
  return isAdmin ? 3 : 7;
}

/** The time (ms since 1970) until which the banner stays hidden after "Not now". */
export function snoozeUntil(now: number, isAdmin: boolean): number {
  return now + snoozeDays(isAdmin) * DAY_MS;
}

/** True while a stored snooze is still in the future. Anything unreadable counts as not snoozed. */
export function isSnoozed(stored: string | null, now: number): boolean {
  if (!stored) return false;
  const until = Number(stored);
  return Number.isFinite(until) && until > now;
}

export function readSnoozed(account: string, now = Date.now()): boolean {
  try {
    return isSnoozed(localStorage.getItem(nudgeStorageKey(account)), now);
  } catch {
    // Storage blocked: stay quiet rather than show it on every page.
    return true;
  }
}

export function writeSnooze(account: string, isAdmin: boolean, now = Date.now()): void {
  try {
    localStorage.setItem(nudgeStorageKey(account), String(snoozeUntil(now, isAdmin)));
  } catch {
    /* nothing to remember it with */
  }
}
