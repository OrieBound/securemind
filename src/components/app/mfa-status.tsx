"use client";

/**
 * Two-step verification status for the signed-in account, shared by the account menu and the reminder
 * banner. `available` is false when this sign-in cannot do two-step (the local sign-in), so nothing
 * about it is shown there.
 */

import { useCallback, useEffect, useState } from "react";
import { ShieldAlert, X } from "lucide-react";
import { MFA_CHANGED_EVENT, readSnoozed, writeSnooze } from "@/lib/client/mfa-nudge";

export type MfaState = { loaded: boolean; available: boolean; enabled: boolean };

export function useMfaStatus(): MfaState {
  const [state, setState] = useState<MfaState>({ loaded: false, available: false, enabled: false });

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/mfa", { credentials: "same-origin", cache: "no-store" });
      if (!res.ok) {
        setState({ loaded: true, available: false, enabled: false });
        return;
      }
      const data = (await res.json()) as { available?: boolean; enabled?: boolean };
      setState({ loaded: true, available: Boolean(data.available), enabled: Boolean(data.enabled) });
    } catch {
      setState({ loaded: true, available: false, enabled: false });
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void load());
    const refresh = () => void load();
    window.addEventListener(MFA_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(MFA_CHANGED_EVENT, refresh);
  }, [load]);

  return state;
}

/** Small On / Off tag for the account menu. Renders nothing when two-step does not apply. */
export function MfaStatusPill({ mfa }: { mfa: MfaState }) {
  if (!mfa.loaded || !mfa.available) return null;
  return (
    <span
      className={
        mfa.enabled
          ? "rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[0.6rem] font-semibold text-emerald-300"
          : "rounded-full border border-amber-500/35 bg-amber-500/10 px-1.5 py-0.5 text-[0.6rem] font-semibold text-amber-300"
      }
    >
      {mfa.enabled ? "Two-step on" : "Two-step off"}
    </span>
  );
}

/**
 * Slim reminder under the header for people who have not turned two-step on. Snoozes when dismissed,
 * and never shows on the Account security page itself or while the first-run tour is up.
 */
export function MfaReminderBanner({
  mfa,
  account,
  isAdmin,
  suppressed,
  onSetUp,
}: {
  mfa: MfaState;
  account: string;
  isAdmin: boolean;
  suppressed: boolean;
  onSetUp: () => void;
}) {
  const [hidden, setHidden] = useState(false);
  // Read the stored snooze after mount, not during render, so server and browser markup agree.
  const [snoozed, setSnoozed] = useState(true);
  useEffect(() => {
    queueMicrotask(() => setSnoozed(readSnoozed(account)));
  }, [account]);

  if (!mfa.loaded || !mfa.available || mfa.enabled || suppressed || snoozed || hidden) return null;

  return (
    <div
      role="region"
      aria-label="Two-step verification reminder"
      className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-amber-500/25 bg-amber-500/10 px-4 py-2"
    >
      <ShieldAlert className="size-4 shrink-0 text-amber-300" aria-hidden />
      <p className="min-w-0 flex-1 text-[0.78rem] leading-snug text-foreground/85">
        <span className="font-semibold">Protect your account with two-step verification.</span>{" "}
        {isAdmin
          ? "Admin accounts can change people, keys and settings, so a password alone is not enough."
          : "It takes about a minute with an authenticator app, and stops a stolen password from being enough."}
      </p>
      <button
        type="button"
        onClick={onSetUp}
        className="rounded-lg bg-amber-400 px-3 py-1.5 text-[0.75rem] font-semibold text-black hover:bg-amber-300 cursor-pointer"
      >
        Set it up
      </button>
      <button
        type="button"
        onClick={() => {
          writeSnooze(account, isAdmin);
          setHidden(true);
        }}
        className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[0.72rem] text-foreground/60 hover:bg-foreground/5 cursor-pointer"
        aria-label={`Remind me in ${isAdmin ? "3 days" : "a week"}`}
      >
        Not now
        <X className="size-3" aria-hidden />
      </button>
    </div>
  );
}
