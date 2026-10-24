/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isSnoozed, nudgeStorageKey, snoozeDays, snoozeUntil } from "@/lib/client/mfa-nudge";
import { MfaReminderBanner, MfaStatusPill } from "@/components/app/mfa-status";
import { SETTINGS_SECTION_LABELS, isSettingsSection } from "@/components/app/settings-hub";

afterEach(cleanup);
beforeEach(() => localStorage.clear());

describe("snooze rules", () => {
  const now = 1_700_000_000_000;
  it("admins are reminded sooner than members", () => {
    expect(snoozeDays(true)).toBe(3);
    expect(snoozeDays(false)).toBe(7);
    expect(snoozeUntil(now, true) - now).toBe(3 * 86_400_000);
  });

  it("is snoozed only while the stored time is in the future", () => {
    expect(isSnoozed(String(now + 1000), now)).toBe(true);
    expect(isSnoozed(String(now - 1000), now)).toBe(false);
    expect(isSnoozed(null, now)).toBe(false);
    expect(isSnoozed("not a number", now)).toBe(false);
  });

  it("keeps one snooze per account", () => {
    expect(nudgeStorageKey("A@x.com")).toBe(nudgeStorageKey("a@x.com"));
    expect(nudgeStorageKey("a@x.com")).not.toBe(nudgeStorageKey("b@x.com"));
  });
});

describe("two-step reminder banner", () => {
  const off = { loaded: true, available: true, enabled: false };
  const base = { account: "a@x.com", isAdmin: false, suppressed: false, onSetUp: () => {} };

  it("asks people who have not turned it on, and opens setup", async () => {
    const onSetUp = vi.fn();
    render(<MfaReminderBanner mfa={off} {...base} onSetUp={onSetUp} />);
    await waitFor(() => expect(screen.getByText(/Protect your account/)).toBeTruthy());
    fireEvent.click(screen.getByText("Set it up"));
    expect(onSetUp).toHaveBeenCalled();
  });

  it("uses firmer wording for Admins", async () => {
    render(<MfaReminderBanner mfa={off} {...base} isAdmin />);
    await waitFor(() => expect(screen.getByText(/Admin accounts can change people/)).toBeTruthy());
  });

  it("goes away on Not now and stays away on the next visit", async () => {
    const { unmount } = render(<MfaReminderBanner mfa={off} {...base} />);
    await waitFor(() => screen.getByText("Set it up"));
    fireEvent.click(screen.getByLabelText(/Remind me in a week/));
    expect(screen.queryByText("Set it up")).toBeNull();
    unmount();
    render(<MfaReminderBanner mfa={off} {...base} />);
    await new Promise(r => setTimeout(r, 20));
    expect(screen.queryByText("Set it up")).toBeNull();
  });

  it("stays hidden when two-step is on, unavailable, still loading, or suppressed", async () => {
    for (const mfa of [
      { loaded: true, available: true, enabled: true },
      { loaded: true, available: false, enabled: false },
      { loaded: false, available: false, enabled: false },
    ]) {
      const { unmount } = render(<MfaReminderBanner mfa={mfa} {...base} />);
      await new Promise(r => setTimeout(r, 20));
      expect(screen.queryByText("Set it up")).toBeNull();
      unmount();
    }
    render(<MfaReminderBanner mfa={off} {...base} suppressed />);
    await new Promise(r => setTimeout(r, 20));
    expect(screen.queryByText("Set it up")).toBeNull();
  });
});

describe("status pill and settings page", () => {
  it("shows On or Off, and nothing where two-step does not apply", () => {
    const { rerender, container } = render(<MfaStatusPill mfa={{ loaded: true, available: true, enabled: false }} />);
    expect(screen.getByText("Two-step off")).toBeTruthy();
    rerender(<MfaStatusPill mfa={{ loaded: true, available: true, enabled: true }} />);
    expect(screen.getByText("Two-step on")).toBeTruthy();
    rerender(<MfaStatusPill mfa={{ loaded: true, available: false, enabled: false }} />);
    expect(container.textContent).toBe("");
  });

  it("Account security is its own settings section, so its name no longer clashes with Insights Security", () => {
    expect(isSettingsSection("account-security")).toBe(true);
    expect(SETTINGS_SECTION_LABELS["account-security"]).toBe("Account security");
    expect(SETTINGS_SECTION_LABELS["insights-security"]).toBe("Security");
  });
});
