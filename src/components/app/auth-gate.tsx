"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type MeResponse = {
  userId: string;
  authenticated: boolean;
  email: string | null;
  mode: string;
};

type Props = {
  children: React.ReactNode;
};

/**
 * When the server is in Cognito mode, require a session before showing the app.
 * Local mode renders children immediately.
 */
export function AuthGate({ children }: Props) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("demo@securemind.local");
  const [password, setPassword] = useState("<demo-password>!");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refreshMe() {
    const res = await fetch("/api/auth/me", { credentials: "same-origin" });
    if (res.status === 401) {
      setMe({ userId: "", authenticated: false, email: null, mode: "cognito" });
      setLoading(false);
      return;
    }
    const data = (await res.json()) as MeResponse;
    setMe(data);
    setLoading(false);
  }

  useEffect(() => {
    void refreshMe();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const path = mode === "login" ? "/api/auth/login" : "/api/auth/signup";
      const res = await fetch(path, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json() as { error?: string; confirmed?: boolean; message?: string };
      if (!res.ok) {
        setError(data.error ?? "Request failed");
        return;
      }
      if (mode === "signup" && data.confirmed === false) {
        setError(data.message ?? "Confirm your email, then sign in.");
        setMode("login");
        return;
      }
      await refreshMe();
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    setMe({ userId: "", authenticated: false, email: null, mode: me?.mode ?? "cognito" });
  }

  if (loading) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background text-sm text-white/40">
        Checking session…
      </div>
    );
  }

  // Local mode — no gate
  if (me && me.mode === "local") {
    return <>{children}</>;
  }

  if (me && me.authenticated) {
    return (
      <div className="relative h-dvh">
        <div className="absolute top-3 right-3 z-50 flex items-center gap-2">
          <span className="text-[0.65rem] text-white/35 truncate max-w-[12rem]">
            {me.email ?? me.userId.slice(0, 8)}
          </span>
          <button
            type="button"
            onClick={() => void logout()}
            className="text-[0.65rem] text-white/45 hover:text-white/70 px-2 py-1 rounded-md border border-white/10 bg-white/[0.03]"
          >
            Sign out
          </button>
        </div>
        {children}
      </div>
    );
  }

  return (
    <div className="flex h-dvh items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#0e0e14] p-6 shadow-2xl space-y-5">
        <div>
          <p className="text-[0.65rem] uppercase tracking-[0.2em] text-indigo-300/60 font-semibold">
            SecureMind
          </p>
          <h1 className="mt-1 text-lg font-bold text-white/90">
            {mode === "login" ? "Sign in" : "Create account"}
          </h1>
          <p className="mt-1.5 text-xs text-white/40 leading-relaxed">
            Local Floci Cognito — $0, no AWS account. Same pool/client shape you will recreate in real Cognito later.
          </p>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <label className="block space-y-1">
            <span className="text-[0.65rem] uppercase tracking-wider text-white/30 font-semibold">Email</span>
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full h-10 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-sm text-white/85 focus:outline-none focus:ring-1 focus:ring-indigo-500/40"
              required
            />
          </label>
          <label className="block space-y-1">
            <span className="text-[0.65rem] uppercase tracking-wider text-white/30 font-semibold">Password</span>
            <input
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full h-10 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-sm text-white/85 focus:outline-none focus:ring-1 focus:ring-indigo-500/40"
              required
              minLength={8}
            />
          </label>

          {error && (
            <p role="alert" className="text-[0.7rem] text-red-300/90">{error}</p>
          )}

          <Button type="submit" disabled={busy} className="w-full h-10 text-sm">
            {busy ? "Working…" : mode === "login" ? "Sign in" : "Create account"}
          </Button>
        </form>

        <button
          type="button"
          onClick={() => { setMode(mode === "login" ? "signup" : "login"); setError(null); }}
          className={cn("text-xs text-white/40 hover:text-white/60 w-full text-center")}
        >
          {mode === "login" ? "Need an account? Sign up" : "Already have an account? Sign in"}
        </button>

        <p className="text-[0.62rem] text-white/25 leading-relaxed text-center">
          Demo user from setup script: demo@securemind.local / <demo-password>!
        </p>
      </div>
    </div>
  );
}
