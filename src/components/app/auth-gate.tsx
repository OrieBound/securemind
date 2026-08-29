"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { AuthSessionProvider } from "@/components/app/auth-session";
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
};

type Props = {
  children: React.ReactNode;
};

type GateMode = "login" | "signup" | "forgot" | "reset";

/**
 * When the server is in Cognito mode, require a session before showing the app.
 * Local mode renders children immediately.
 */
export function AuthGate({ children }: Props) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<GateMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refreshMe() {
    try {
      const res = await fetch("/api/auth/me", { credentials: "same-origin" });
      if (res.status === 401) {
        setMe({ userId: "", authenticated: false, email: null, mode: "cognito" });
        return;
      }
      if (!res.ok) {
        let modeHint = "cognito";
        try {
          const errBody = (await res.json()) as { mode?: string };
          if (errBody.mode) modeHint = errBody.mode;
        } catch {
          /* HTML 404 / empty body */
        }
        setMe({ userId: "", authenticated: false, email: null, mode: modeHint });
        setError(
          res.status === 404
            ? "Session API unavailable. Restart npm run dev, or set AUTH_MODE=local in .env.local."
            : `Session check failed (${res.status}).`,
        );
        return;
      }
      const data = (await res.json()) as MeResponse;
      setMe(data);
    } catch {
      setMe({ userId: "", authenticated: false, email: null, mode: "cognito" });
      setError("Could not reach the server. Is npm run dev running?");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshMe();
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

      const path = mode === "login" ? "/api/auth/login" : "/api/auth/signup";
      const res = await fetch(path, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json() as {
        error?: string;
        confirmed?: boolean;
        message?: string;
        accessToken?: string;
      };
      if (!res.ok) {
        setError(data.error ?? "Request failed");
        return;
      }
      if (mode === "signup" && data.confirmed === false) {
        setError(data.message ?? "Confirm your email, then sign in.");
        setMode("login");
        return;
      }
      if (data.accessToken) storeClientAccessToken(data.accessToken);
      await refreshMe();
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  const logout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    storeClientAccessToken(null);
    setMe(prev => ({
      userId: "",
      authenticated: false,
      email: null,
      mode: prev?.mode ?? "cognito",
    }));
  }, []);

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

  if (me && me.mode === "local") {
    return <AuthSessionProvider value={null}>{children}</AuthSessionProvider>;
  }

  if (me && me.authenticated) {
    return (
      <AuthSessionProvider value={session}>
        {children}
      </AuthSessionProvider>
    );
  }

  const title =
    mode === "login" ? "Sign in"
    : mode === "signup" ? "Create account"
    : mode === "forgot" ? "Forgot password"
    : "Reset password";

  return (
    <div className="flex h-dvh items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-2xl border border-foreground/10 bg-popover p-6 shadow-2xl space-y-5">
        <div>
          <p className="text-meta uppercase tracking-[0.2em] text-[var(--primary-soft-foreground)] font-medium">
            {PRODUCT_NAME}
          </p>
          <h1 className="text-title mt-1.5">{title}</h1>
          <p className="text-ui text-[var(--text-muted)] mt-2 leading-[var(--leading-body)]">
            {mode === "forgot" || mode === "reset"
              ? "We will never confirm whether an email is registered."
              : PRODUCT_POSITIONING}
          </p>
        </div>

        <form onSubmit={submit} className="space-y-3.5">
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

          {(mode === "login" || mode === "signup") && (
            <label className="block space-y-1.5">
              <span className="text-label uppercase tracking-wider text-[var(--text-muted)]">Password</span>
              <input
                type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full h-10 rounded-lg border border-foreground/10 bg-foreground/[0.04] px-3 text-[length:var(--font-size-body)] font-normal text-[var(--text-body)] focus:outline-none focus:ring-1 focus:ring-indigo-500/40"
                required
                minLength={8}
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
              : mode === "signup" ? "Create account"
              : mode === "forgot" ? "Send reset code"
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
          {(mode === "forgot" || mode === "reset") && (
            <button
              type="button"
              onClick={() => { setMode("login"); setError(null); setNotice(null); }}
              className={cn("text-ui text-[var(--text-muted)] hover:text-foreground/70 w-full text-center")}
            >
              Back to sign in
            </button>
          )}
          {(mode === "login" || mode === "signup") && (
            <button
              type="button"
              onClick={() => {
                setMode(mode === "login" ? "signup" : "login");
                setError(null);
                setNotice(null);
              }}
              className={cn("text-ui text-[var(--text-muted)] hover:text-foreground/70 w-full text-center")}
            >
              {mode === "login" ? "Need an account? Sign up" : "Already have an account? Sign in"}
            </button>
          )}
        </div>

      </div>
    </div>
  );
}
