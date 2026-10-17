"use client";

import { useCallback, useEffect, useState } from "react";
import qrcode from "qrcode-generator";
import { Loader2, ShieldAlert, ShieldCheck } from "lucide-react";

type MfaStatus = { available: boolean; enabled: boolean; recommended: boolean };
type SetupInfo = { otpauthUri: string; secret: string; qr: string };
type View = "loading" | "unavailable" | "off" | "setup" | "on" | "turning-off";

/** A QR code as an image the browser can show. Made locally; the secret never leaves the page. */
export function qrDataUrl(text: string): string {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createDataURL(5, 12);
}

const inputClass =
  "w-full h-9 rounded-lg border border-foreground/10 bg-foreground/[0.04] px-3 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500/40";
const buttonClass =
  "rounded-lg border border-foreground/15 px-3 py-2 text-[0.72rem] cursor-pointer disabled:opacity-40";

/**
 * Two-step verification with an authenticator app (My Profile). Cognito makes the secret and
 * checks the codes; this only walks the person through it.
 */
export function MfaSettings() {
  const [view, setView] = useState<View>("loading");
  const [recommended, setRecommended] = useState(false);
  const [setup, setSetup] = useState<SetupInfo | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/mfa", { credentials: "same-origin" });
      if (!res.ok) {
        setView("unavailable");
        return;
      }
      const data = (await res.json()) as MfaStatus;
      setRecommended(Boolean(data.recommended));
      setView(!data.available ? "unavailable" : data.enabled ? "on" : "off");
    } catch {
      setView("unavailable");
    }
  }, []);

  useEffect(() => {
    // Fetch on mount; the setState calls happen after the request, not synchronously.
    queueMicrotask(() => void load());
  }, [load]);

  async function post(path: string, body: unknown) {
    const res = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, data };
  }

  async function beginSetup() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { ok, data } = await post("/api/auth/mfa/setup", {});
      if (!ok) {
        setError(String(data.error ?? "Could not start setup."));
        return;
      }
      const uri = String(data.otpauthUri);
      setSetup({ otpauthUri: uri, secret: String(data.secret), qr: qrDataUrl(uri) });
      setCode("");
      setView("setup");
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmSetup(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { ok, data } = await post("/api/auth/mfa/verify", { code });
      if (!ok) {
        setError(String(data.error ?? "That code did not work."));
        setCode("");
        return;
      }
      setSetup(null);
      setCode("");
      setView("on");
      setNotice("Two-step verification is on. You will be asked for a code each time you sign in.");
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  async function turnOff(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { ok, data } = await post("/api/auth/mfa/disable", { password });
      if (!ok) {
        setError(String(data.error ?? "Could not turn it off."));
        return;
      }
      setPassword("");
      setView("off");
      setNotice("Two-step verification is off. Your password alone now signs you in.");
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  const heading = (
    <h3 className="text-[0.72rem] font-semibold uppercase tracking-wider text-foreground/55">
      Two-step verification
    </h3>
  );

  if (view === "loading") {
    return (
      <div className="space-y-2" data-testid="mfa-settings">
        {heading}
        <p className="flex items-center gap-2 text-[0.7rem] text-foreground/40">
          <Loader2 className="size-3.5 animate-spin" aria-hidden /> Checking…
        </p>
      </div>
    );
  }

  if (view === "unavailable") {
    return (
      <div className="space-y-2" data-testid="mfa-settings">
        {heading}
        <p className="text-[0.7rem] leading-relaxed text-foreground/40">
          Two-step verification works with Amazon Cognito. This install uses the local sign-in,
          which checks a password only, so there is nothing to turn on here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="mfa-settings">
      {heading}

      {notice && (
        <p role="status" className="text-[0.7rem] text-emerald-300/90">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="text-[0.7rem] text-red-300/90">
          {error}
        </p>
      )}

      {view === "off" && (
        <>
          {recommended ? (
            <div
              role="note"
              className="flex gap-2.5 rounded-lg border border-amber-400/30 bg-amber-400/[0.07] px-3 py-2.5"
            >
              <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-300" aria-hidden />
              <p className="text-[0.72rem] leading-relaxed text-foreground/75">
                <span className="font-medium text-foreground/90">Highly recommended for your account.</span>{" "}
                You manage people, provider keys and settings here, so a password alone is a lot to
                rely on. With a second step, a stolen password cannot sign in without your phone.
              </p>
            </div>
          ) : (
            <p className="text-[0.7rem] leading-relaxed text-foreground/45">
              Add a second step at sign-in: a 6-digit code from an authenticator app on your phone.
              It is optional, and it protects your account if your password is ever stolen.
            </p>
          )}
          <button type="button" onClick={() => void beginSetup()} disabled={busy} className={buttonClass}>
            {busy ? "Starting…" : "Set up two-step verification"}
          </button>
        </>
      )}

      {view === "setup" && setup && (
        <form onSubmit={confirmSetup} className="space-y-3">
          <ol className="list-decimal space-y-1 pl-4 text-[0.72rem] leading-relaxed text-foreground/60">
            <li>Install an authenticator app, such as Google Authenticator, Microsoft Authenticator, 1Password or Authy.</li>
            <li>Scan this code with the app, or choose &quot;enter a key&quot; and type the key below.</li>
            <li>Type the 6-digit code the app shows now, to confirm it works.</li>
          </ol>
          <div className="flex flex-wrap items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={setup.qr}
              alt="QR code for your authenticator app"
              width={176}
              height={176}
              className="rounded-lg bg-white p-2"
            />
            <div className="min-w-0 space-y-1">
              <p className="text-[0.65rem] uppercase tracking-wider text-foreground/40">Key to type by hand</p>
              <code className="block break-all rounded bg-foreground/[0.06] px-2 py-1 text-[0.78rem] tracking-wider">
                {setup.secret}
              </code>
              <p className="max-w-[16rem] text-[0.65rem] leading-snug text-foreground/35">
                Anyone with this key can make your codes. Do not share or save it elsewhere.
              </p>
            </div>
          </div>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9 ]*"
            autoComplete="one-time-code"
            maxLength={7}
            value={code}
            onChange={e => setCode(e.target.value.replace(/[^0-9 ]/g, ""))}
            placeholder="123456"
            aria-label="6-digit code from your authenticator app"
            className={`${inputClass} max-w-[12rem] text-center font-mono tracking-[0.3em]`}
            required
          />
          <div className="flex gap-2">
            <button type="submit" disabled={busy || code.replace(/\s/g, "").length !== 6} className={buttonClass}>
              {busy ? "Checking…" : "Turn on"}
            </button>
            <button
              type="button"
              onClick={() => {
                setSetup(null);
                setError(null);
                setView("off");
              }}
              className={`${buttonClass} text-foreground/55`}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {view === "on" && (
        <>
          <p className="flex items-center gap-2 text-[0.72rem] text-emerald-300/90">
            <ShieldCheck className="size-4" aria-hidden /> On. You are asked for a code at sign-in.
          </p>
          <p className="text-[0.68rem] leading-relaxed text-foreground/40">
            Lost your phone? An administrator can reset this from the Admin page. If you are the
            only administrator, see docs/mfa.md for the one-line command.
          </p>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setNotice(null);
              setView("turning-off");
            }}
            className={`${buttonClass} text-foreground/60`}
          >
            Turn off…
          </button>
        </>
      )}

      {view === "turning-off" && (
        <form onSubmit={turnOff} className="space-y-2.5">
          <p className="text-[0.7rem] leading-relaxed text-foreground/50">
            Enter your password to turn two-step verification off.
          </p>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Password"
            aria-label="Your password"
            className={`${inputClass} max-w-xs`}
            required
          />
          <div className="flex gap-2">
            <button type="submit" disabled={busy || !password} className={buttonClass}>
              {busy ? "Turning off…" : "Turn off"}
            </button>
            <button
              type="button"
              onClick={() => {
                setPassword("");
                setError(null);
                setView("on");
              }}
              className={`${buttonClass} text-foreground/55`}
            >
              Keep it on
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
