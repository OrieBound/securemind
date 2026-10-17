"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { AuthSessionProvider } from "@/components/app/auth-session";
import { InstanceSetupWizard } from "@/components/app/instance-setup-wizard";
import { ProductMark } from "@/components/app/product-mark";
import { PRODUCT_NAME, PRODUCT_POSITIONING } from "@/lib/branding";
import { cn } from "@/lib/utils";
import { storeClientAccessToken } from "@/lib/client/api-base";

type MeResponse = {
  userId: string;
  authenticated: boolean;
  email: string | null;
  mode: string;
  role?: "super_admin" | "admin" | "member";
  groups?: string[];
  accessToken?: string;
};

type SetupStatus = {
  authMode: string;
  edition: "local" | "cloud";
  cognitoConfigured: boolean;
  directoryEmpty: boolean | null;
  claimAvailable: boolean;
  claimRequiresCode: boolean;
  codeConfigured: boolean;
  setupComplete: boolean;
  preferredStorage: "postgres" | "dynamodb";
  minPasswordLength: number;
};

type Props = {
  children: React.ReactNode;
};

type GateMode = "login" | "claim" | "forgot" | "reset" | "mfa";

/**
 * When the server is in Cognito mode, require a session before showing the app.
 * Local mode still runs the first-run wizard until setup is complete.
 */
export function AuthGate({ children }: Props) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [setup, setSetup] = useState<SetupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<GateMode>("login");
  const [email, setEmail] = useState("");
  const [emailConfirm, setEmailConfirm] = useState("");
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [setupCode, setSetupCode] = useState("");
  const [code, setCode] = useState("");
  // Two-step verification: the session from the password step, and the code the user types.
  const [mfaSession, setMfaSession] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refreshMe(): Promise<MeResponse | null> {
    try {
      const res = await fetch("/api/auth/me", { credentials: "same-origin" });
      if (res.status === 401) {
        const unauth: MeResponse = { userId: "", authenticated: false, email: null, mode: "cognito" };
        setMe(unauth);
        return unauth;
      }
      if (!res.ok) {
        let modeHint = "cognito";
        try {
          const errBody = (await res.json()) as { mode?: string };
          if (errBody.mode) modeHint = errBody.mode;
        } catch {
          /* HTML 404 / empty body */
        }
        const failed: MeResponse = { userId: "", authenticated: false, email: null, mode: modeHint };
        setMe(failed);
        setError(
          res.status === 404
            ? "Session API unavailable. Restart npm run dev, or set AUTH_MODE=local in .env.local."
            : `Session check failed (${res.status}).`,
        );
        return failed;
      }
      const data = (await res.json()) as MeResponse;
      if (data.accessToken) storeClientAccessToken(data.accessToken);
      setMe(data);
      return data;
    } catch {
      const failed: MeResponse = { userId: "", authenticated: false, email: null, mode: "cognito" };
      setMe(failed);
      setError("Could not reach the server. Is npm run dev running?");
      return failed;
    }
  }

  async function refreshSetup(): Promise<SetupStatus | null> {
    try {
      const res = await fetch("/api/setup/status", { credentials: "same-origin" });
      if (!res.ok) return null;
      const data = (await res.json()) as SetupStatus;
      setSetup(data);
      return data;
    } catch {
      return null;
    }
  }

  useEffect(() => {
    void (async () => {
      const [meData, setupData] = await Promise.all([refreshMe(), refreshSetup()]);
      if (setupData?.claimAvailable && !meData?.authenticated) {
        setMode("claim");
      }
      setLoading(false);
    })();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === "forgot") {
        const res = await fetch("/api/auth/forgot-password", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        });
        const data = (await res.json()) as { error?: string; message?: string };
        if (!res.ok) {
          setError(data.error ?? "Request failed");
          return;
        }
        setNotice(data.message ?? "If an account exists, a reset code was sent.");
        setMode("reset");
        return;
      }

      if (mode === "reset") {
        const res = await fetch("/api/auth/confirm-forgot-password", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            code,
            newPassword,
            confirmPassword,
          }),
        });
        const data = (await res.json()) as { error?: string; message?: string };
        if (!res.ok) {
          setError(data.error ?? "Reset failed");
          return;
        }
        setNotice(data.message ?? "Password reset. Sign in with your new password.");
        setMode("login");
        setPassword("");
        setCode("");
        setNewPassword("");
        setConfirmPassword("");
        return;
      }

      if (mode === "mfa") {
        const res = await fetch("/api/auth/login/mfa", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, session: mfaSession, code: mfaCode }),
        });
        const data = await res.json() as {
          error?: string;
          accessToken?: string;
          restart?: boolean;
        };
        if (!res.ok) {
          setError(data.error ?? "Request failed");
          setMfaCode("");
          // The sign-in attempt expired: go back and ask for the password again.
          if (data.restart) {
            setMfaSession("");
            setMode("login");
          }
          return;
        }
        setMfaSession("");
        setMfaCode("");
        if (data.accessToken) storeClientAccessToken(data.accessToken);
        await Promise.all([refreshMe(), refreshSetup()]);
        return;
      }

      if (mode === "claim") {
        const res = await fetch("/api/setup/claim", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            emailConfirm,
            password,
            passwordConfirm,
            setupCode: setup?.claimRequiresCode ? setupCode : undefined,
          }),
        });
        const data = await res.json() as { error?: string; accessToken?: string };
        if (!res.ok) {
          setError(data.error ?? "Request failed");
          return;
        }
        if (data.accessToken) storeClientAccessToken(data.accessToken);
        await Promise.all([refreshMe(), refreshSetup()]);
        return;
      }

      const res = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json() as {
        error?: string;
        accessToken?: string;
        mfaRequired?: boolean;
        session?: string;
      };
      if (!res.ok) {
        setError(data.error ?? "Request failed");
        return;
      }
      if (data.mfaRequired && data.session) {
        // Right password, and this account uses an authenticator app: ask for the code.
        setMfaSession(data.session);
        setMfaCode("");
        setPassword("");
        setMode("mfa");
        return;
      }
      if (data.accessToken) storeClientAccessToken(data.accessToken);
      await Promise.all([refreshMe(), refreshSetup()]);
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  const logout = useCallback(async (reason?: string) => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    storeClientAccessToken(null);
    setMe(prev => ({
      userId: "",
      authenticated: false,
      email: null,
      mode: prev?.mode ?? "cognito",
    }));
    if (reason) setError(reason);
    const next = await refreshSetup();
    setMode(next?.claimAvailable ? "claim" : "login");
  }, []);

  useEffect(() => {
    if (!me?.authenticated || me.mode === "local") return;
    let cancelled = false;
    const recheck = async () => {
      try {
        const res = await fetch("/api/auth/me", { credentials: "same-origin" });
        if (cancelled || res.ok) return;
        if (res.status === 401) {
          setMe({ userId: "", authenticated: false, email: null, mode: me.mode });
          setError("Your sign-in expired. Sign in again.");
        }
      } catch {
        /* Keep the current screen if the server is briefly unreachable. */
      }
    };
    const onFocus = () => { void recheck(); };
    window.addEventListener("focus", onFocus);
    const id = window.setInterval(() => { void recheck(); }, 60_000);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      window.clearInterval(id);
    };
  }, [me?.authenticated, me?.mode]);

  const session = useMemo(
    () =>
      me && me.authenticated
        ? {
            userId: me.userId,
            email: me.email,
            role: me.role,
            logout,
          }
        : null,
    [me, logout],
  );

  if (loading) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background text-sm text-foreground/40">
        Checking session…
      </div>
    );
  }

  const setupComplete = Boolean(setup?.setupComplete);
  const isLocal = me?.mode === "local";
  const signedIn = Boolean(me && (me.authenticated || isLocal));

  if (signedIn && !setupComplete && setup) {
    return (
      <InstanceSetupWizard
        edition={setup.edition}
        onDone={() => {
          void refreshSetup();
        }}
      />
    );
  }

  if (signedIn) {
    return (
      <AuthSessionProvider value={isLocal ? null : session}>
        {children}
      </AuthSessionProvider>
    );
  }

  const title =
    mode === "login" ? "Sign in"
    : mode === "claim" ? "Create the first owner"
    : mode === "forgot" ? "Forgot password"
    : mode === "mfa" ? "Two-step verification"
    : "Reset password";

  const minPw = setup?.minPasswordLength ?? 8;

  return (
    <div className="flex h-dvh items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-2xl border border-foreground/10 bg-popover p-6 shadow-2xl space-y-5">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <ProductMark size={40} className="size-10 shrink-0" />
            <div>
              <p className="text-meta uppercase tracking-[0.2em] text-[var(--primary-soft-foreground)] font-medium">
                {PRODUCT_NAME}
              </p>
              <h1 className="text-title mt-1.5">{title}</h1>
            </div>
          </div>
          <p className="text-ui text-[var(--text-muted)] leading-[var(--leading-body)]">
            {mode === "mfa"
              ? "Enter the 6-digit code from your authenticator app."
              : mode === "forgot" || mode === "reset"
              ? "We will never confirm whether an email is registered."
              : mode === "claim"
                ? setup?.claimRequiresCode
                  ? "Enter the setup code printed once when the stack was applied (terraform output -raw setup_claim_secret). Choose the email and password you will use. The setup code is not your password."
                  : "Choose the email and password you will use as Owner. There is no demo account."
                : PRODUCT_POSITIONING}
          </p>
        </div>

        {mode === "claim" && setup?.claimRequiresCode && !setup.codeConfigured && (
          <p role="alert" className="text-meta text-amber-300/90">
            SETUP_CLAIM_SECRET is not configured on this host. Apply Terraform and retry — the code is never shown on this page.
          </p>
        )}

        <form onSubmit={submit} className="space-y-3.5">
          {mode === "mfa" ? (
            <>
              <p className="text-meta text-[var(--text-muted)]">
                Signing in as <span className="text-foreground/80">{email}</span>
              </p>
              <label className="block space-y-1.5">
                <span className="text-label uppercase tracking-wider text-[var(--text-muted)]">Authentication code</span>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9 ]*"
                  autoComplete="one-time-code"
                  autoFocus
                  maxLength={7}
                  value={mfaCode}
                  onChange={e => setMfaCode(e.target.value.replace(/[^0-9 ]/g, ""))}
                  placeholder="123456"
                  aria-label="6-digit authentication code"
                  className="w-full h-11 rounded-lg border border-foreground/10 bg-foreground/[0.04] px-3 text-center text-lg tracking-[0.35em] font-mono text-[var(--text-body)] focus:outline-none focus:ring-1 focus:ring-indigo-500/40"
                  required
                />
              </label>
            </>
          ) : (
          <label className="block space-y-1.5">
            <span className="text-label uppercase tracking-wider text-[var(--text-muted)]">Email</span>
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full h-10 rounded-lg border border-foreground/10 bg-foreground/[0.04] px-3 text-[length:var(--font-size-body)] font-normal text-[var(--text-body)] focus:outline-none focus:ring-1 focus:ring-indigo-500/40"
              required
            />
          </label>
          )}

          {mode === "claim" && (
            <label className="block space-y-1.5">
              <span className="text-label uppercase tracking-wider text-[var(--text-muted)]">Confirm email</span>
              <input
                type="email"
                autoComplete="off"
                value={emailConfirm}
                onChange={e => setEmailConfirm(e.target.value)}
                className="w-full h-10 rounded-lg border border-foreground/10 bg-foreground/[0.04] px-3 text-[length:var(--font-size-body)] font-normal text-[var(--text-body)] focus:outline-none focus:ring-1 focus:ring-indigo-500/40"
                required
              />
            </label>
          )}

          {(mode === "login" || mode === "claim") && (
            <label className="block space-y-1.5">
              <span className="text-label uppercase tracking-wider text-[var(--text-muted)]">Password</span>
              <input
                type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full h-10 rounded-lg border border-foreground/10 bg-foreground/[0.04] px-3 text-[length:var(--font-size-body)] font-normal text-[var(--text-body)] focus:outline-none focus:ring-1 focus:ring-indigo-500/40"
                required
                minLength={mode === "claim" ? minPw : 8}
              />
            </label>
          )}

          {mode === "claim" && (
            <label className="block space-y-1.5">
              <span className="text-label uppercase tracking-wider text-[var(--text-muted)]">Confirm password</span>
              <input
                type="password"
                autoComplete="new-password"
                value={passwordConfirm}
                onChange={e => setPasswordConfirm(e.target.value)}
                className="w-full h-10 rounded-lg border border-foreground/10 bg-foreground/[0.04] px-3 text-[length:var(--font-size-body)] font-normal text-[var(--text-body)] focus:outline-none focus:ring-1 focus:ring-indigo-500/40"
                required
                minLength={minPw}
              />
            </label>
          )}

          {mode === "claim" && setup?.claimRequiresCode && (
            <label className="block space-y-1.5">
              <span className="text-label uppercase tracking-wider text-[var(--text-muted)]">Setup code</span>
              <input
                type="text"
                autoComplete="off"
                value={setupCode}
                onChange={e => setSetupCode(e.target.value)}
                className="w-full h-10 rounded-lg border border-foreground/10 bg-foreground/[0.04] px-3 text-sm font-mono"
                required
              />
            </label>
          )}

          {mode === "reset" && (
            <>
              <label className="block space-y-1.5">
                <span className="text-label uppercase tracking-wider text-[var(--text-muted)]">Code</span>
                <input
                  value={code}
                  onChange={e => setCode(e.target.value)}
                  className="w-full h-10 rounded-lg border border-foreground/10 bg-foreground/[0.04] px-3 text-sm font-mono"
                  required
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-label uppercase tracking-wider text-[var(--text-muted)]">New password</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  className="w-full h-10 rounded-lg border border-foreground/10 bg-foreground/[0.04] px-3 text-sm"
                  required
                  minLength={12}
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-label uppercase tracking-wider text-[var(--text-muted)]">Confirm password</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  className="w-full h-10 rounded-lg border border-foreground/10 bg-foreground/[0.04] px-3 text-sm"
                  required
                  minLength={12}
                />
              </label>
            </>
          )}

          {error && (
            <p role="alert" className="text-meta text-red-300/90">{error}</p>
          )}
          {notice && (
            <p role="status" className="text-meta text-emerald-300/90">{notice}</p>
          )}

          <Button type="submit" disabled={busy} className="w-full h-10 text-sm font-medium">
            {busy
              ? "Working…"
              : mode === "login" ? "Sign in"
              : mode === "claim" ? "Create owner account"
              : mode === "forgot" ? "Send reset code"
              : mode === "mfa" ? "Verify and sign in"
              : "Set new password"}
          </Button>
        </form>

        <div className="space-y-2">
          {mode === "login" && (
            <button
              type="button"
              onClick={() => { setMode("forgot"); setError(null); setNotice(null); }}
              className={cn("text-ui text-[var(--text-muted)] hover:text-foreground/70 w-full text-center")}
            >
              Forgot password?
            </button>
          )}
          {mode === "mfa" && (
            <button
              type="button"
              onClick={() => { setMode("login"); setMfaSession(""); setMfaCode(""); setError(null); setNotice(null); }}
              className={cn("text-ui text-[var(--text-muted)] hover:text-foreground/70 w-full text-center")}
            >
              Back to sign in
            </button>
          )}
          {(mode === "forgot" || mode === "reset") && (
            <button
              type="button"
              onClick={() => { setMode("login"); setError(null); setNotice(null); }}
              className={cn("text-ui text-[var(--text-muted)] hover:text-foreground/70 w-full text-center")}
            >
              Back to sign in
            </button>
          )}
          {mode === "claim" && !setup?.claimAvailable && (
            <button
              type="button"
              onClick={() => { setMode("login"); setError(null); setNotice(null); }}
              className={cn("text-ui text-[var(--text-muted)] hover:text-foreground/70 w-full text-center")}
            >
              Already have an account? Sign in
            </button>
          )}
          {mode === "login" && setup?.claimAvailable && (
            <button
              type="button"
              onClick={() => { setMode("claim"); setError(null); setNotice(null); }}
              className={cn("text-ui text-[var(--text-muted)] hover:text-foreground/70 w-full text-center")}
            >
              First time here? Create the owner account
            </button>
          )}
        </div>

      </div>
    </div>
  );
}
