"use client";

/**
 * Admin console — org-wide activity + Cognito user directory + spend limits.
 * Visible to Admin and Super Admin.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart2, Loader2, RefreshCw, Shield, UserPlus, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AppRole, AssignableRole } from "@/lib/roles";
import type { AnalyticsRange } from "@/lib/analytics/types";
import type { InsightsSubjectRef } from "@/components/app/settings-hub";
import { fmtUsdLabeled } from "@/lib/analytics/client";
import { parseMonthlyCostCapInput } from "@/lib/cost-cap-shared";

type PendingConfirm = {
  title: string;
  identity: string;
  currentRole?: string;
  newRole?: string;
  impact: string;
  confirmLabel: string;
  destructive?: boolean;
  run: () => void | Promise<void>;
};

type DirectoryUser = {
  username: string;
  sub: string | null;
  email: string | null;
  enabled: boolean;
  status: string;
  role: AppRole;
  groups: string[];
  createdAt: string | null;
  isOwner?: boolean;
  monthlyCostCapUsd?: number | null;
  monthSpendUsd?: number;
};

type Overview = {
  range: AnalyticsRange;
  usersWithActivity: number;
  workspaceCount: number;
  documentCount: number;
  inferenceRequests: number;
  promptTokens: number;
  completionTokens: number;
  estimatedCostUsd: number;
  securityEvents: number;
  highRiskBlocked: number;
  directoryUserCount: number;
  cognitoAvailable: boolean;
  byUser: Array<{
    userId: string;
    label: string;
    email: string | null;
    workspaces: number;
    documents: number;
    inferenceRequests: number;
    estimatedCostUsd: number;
    securityEvents: number;
  }>;
};

const RANGES: { id: AnalyticsRange; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "all", label: "All time" },
];

const CAP_PRESETS: { label: string; value: number | null }[] = [
  { label: "$5", value: 5 },
  { label: "$10", value: 10 },
  { label: "$25", value: 25 },
  { label: "$50", value: 50 },
  { label: "Unlimited", value: null },
];

function fmtUsd(n: number) {
  if (!Number.isFinite(n) || n === 0) return "$0.00";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function SpendMeter({
  spent,
  cap,
  compact,
}: {
  spent: number;
  cap: number | null | undefined;
  compact?: boolean;
}) {
  if (cap == null) {
    return (
      <div className={cn("text-[var(--text-secondary)]", compact ? "text-[0.65rem]" : "text-xs")}>
        {fmtUsdLabeled(spent)} · Unlimited
      </div>
    );
  }
  const pct = cap > 0 ? Math.min(100, (spent / cap) * 100) : 100;
  const over = spent >= cap;
  return (
    <div className="space-y-1 min-w-[7rem]">
      <div className={cn("tabular-nums", compact ? "text-[0.65rem]" : "text-xs", over && "text-destructive")}>
        {fmtUsdLabeled(spent)} of {fmtUsdLabeled(cap)}
      </div>
      <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            over ? "bg-destructive" : pct >= 80 ? "bg-[var(--warning)]" : pct >= 50 ? "bg-amber-400" : "bg-primary",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

type UserSortKey = "label" | "inferenceRequests" | "estimatedCostUsd" | "securityEvents";

export function AdminConsole({
  onOpenUserInsights,
  actorRole = "admin",
}: {
  onOpenUserInsights?: (subject: InsightsSubjectRef) => void;
  /** Current signed-in elevated role — Owner can edit Owner row. */
  actorRole?: AppRole;
} = {}) {
  const [range, setRange] = useState<AnalyticsRange>("30d");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const [cognitoAvailable, setCognitoAvailable] = useState(true);
  const [mailConfigured, setMailConfigured] = useState(false);
  const [defaultCap, setDefaultCap] = useState(10);
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [usersLoading, setUsersLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [userQuery, setUserQuery] = useState("");
  const [userSort, setUserSort] = useState<UserSortKey>("inferenceRequests");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newRole, setNewRole] = useState<AssignableRole>("member");
  const [newCap, setNewCap] = useState<number | null>(10);
  const [customCap, setCustomCap] = useState("");
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);
  const [rowCustomCap, setRowCustomCap] = useState<{ username: string; value: string } | null>(null);

  const isOwnerActor = actorRole === "super_admin";

  const labeledOverview = useMemo(() => {
    if (!overview) return null;
    const emailBySub = new Map(
      users.filter(u => u.sub).map(u => [u.sub as string, u.email]),
    );
    return {
      ...overview,
      directoryUserCount: users.length || overview.directoryUserCount,
      byUser: overview.byUser.map(row => {
        const email = emailBySub.get(row.userId) ?? row.email;
        return {
          ...row,
          email,
          label: email ?? (row.userId === "local" ? "local" : `${row.userId.slice(0, 8)}…`),
        };
      }),
    };
  }, [overview, users]);

  const filteredByUser = useMemo(() => {
    const rows = labeledOverview?.byUser ?? [];
    const q = userQuery.trim().toLowerCase();
    const filtered = q
      ? rows.filter(r =>
          r.label.toLowerCase().includes(q)
          || (r.email?.toLowerCase().includes(q) ?? false)
          || r.userId.toLowerCase().includes(q),
        )
      : rows;
    const sorted = [...filtered].sort((a, b) => {
      if (userSort === "label") return a.label.localeCompare(b.label);
      return (b[userSort] ?? 0) - (a[userSort] ?? 0);
    });
    return sorted;
  }, [labeledOverview?.byUser, userQuery, userSort]);

  const spendLeaders = useMemo(() => {
    return [...users]
      .map(u => {
        const cap = u.monthlyCostCapUsd;
        const spent = u.monthSpendUsd ?? 0;
        const ratio = cap == null || cap <= 0 ? 0 : spent / cap;
        return { ...u, ratio, spent, cap };
      })
      .filter(u => u.cap != null)
      .sort((a, b) => b.ratio - a.ratio || b.spent - a.spent)
      .slice(0, 8);
  }, [users]);

  const refreshOverview = useCallback(async (signal?: AbortSignal) => {
    setOverviewLoading(true);
    setError(null);
    try {
      const oRes = await fetch(`/api/admin/overview?range=${range}`, {
        credentials: "same-origin",
        signal,
      });
      if (signal?.aborted) return;
      if (oRes.status === 403) {
        setError("Operator access required.");
        return;
      }
      if (oRes.ok) {
        setOverview((await oRes.json()) as Overview);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      if (err instanceof Error && err.name === "AbortError") return;
      setError("Failed to load activity.");
    } finally {
      if (!signal?.aborted) setOverviewLoading(false);
    }
  }, [range]);

  const refreshUsers = useCallback(async (signal?: AbortSignal) => {
    setUsersLoading(true);
    try {
      const uRes = await fetch("/api/admin/users", {
        credentials: "same-origin",
        signal,
      });
      if (signal?.aborted) return;
      if (uRes.status === 403) {
        setError("Operator access required.");
        return;
      }
      if (uRes.ok) {
        const body = (await uRes.json()) as {
          available: boolean;
          users: DirectoryUser[];
          mailConfigured?: boolean;
          defaultMonthlyCostCapUsd?: number;
          error?: string;
        };
        setCognitoAvailable(body.available);
        setMailConfigured(Boolean(body.mailConfigured));
        setUsers(body.users ?? []);
        setDirectoryError(body.error ?? null);
        if (typeof body.defaultMonthlyCostCapUsd === "number") {
          setDefaultCap(body.defaultMonthlyCostCapUsd);
          setNewCap(prev => (prev === 10 ? body.defaultMonthlyCostCapUsd! : prev));
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      if (err instanceof Error && err.name === "AbortError") return;
      setError("Failed to load directory.");
    } finally {
      if (!signal?.aborted) setUsersLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    await Promise.all([refreshOverview(), refreshUsers()]);
  }, [refreshOverview, refreshUsers]);

  useEffect(() => {
    const ac = new AbortController();
    void refreshOverview(ac.signal);
    return () => ac.abort();
  }, [refreshOverview]);

  useEffect(() => {
    const ac = new AbortController();
    void refreshUsers(ac.signal);
    return () => ac.abort();
  }, [refreshUsers]);

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNote(null);
    setError(null);
    const capParsed = parseMonthlyCostCapInput(customCap.trim() !== "" ? customCap : newCap);
    if (!capParsed.ok) {
      setError(capParsed.error);
      setBusy(false);
      return;
    }
    const capValue = capParsed.value ?? null;
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          role: newRole,
          monthlyCostCapUsd: capValue,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        mailConfigured?: boolean;
        welcomeEmail?: { sent: boolean; reason?: string };
      };
      if (!res.ok) {
        setError(data.error ?? "Could not create user");
        return;
      }
      if (typeof data.mailConfigured === "boolean") setMailConfigured(data.mailConfigured);
      const createdEmail = email;
      const createdRole = newRole;
      setEmail("");
      setPassword("");
      setNewRole("member");
      setNewCap(defaultCap);
      setCustomCap("");
      if (data.welcomeEmail?.sent) {
        setNote(`Created ${createdEmail} as ${createdRole}. Welcome email sent.`);
      } else if (data.welcomeEmail?.reason === "send_failed") {
        setNote(
          `Created ${createdEmail} as ${createdRole}. Welcome email failed to send — share the sign-in details manually.`,
        );
      } else {
        setNote(
          `Created ${createdEmail} as ${createdRole}. Welcome email not sent (SMTP not configured) — share the sign-in details manually.`,
        );
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  async function patchUser(
    username: string,
    body: {
      role?: AssignableRole;
      enabled?: boolean;
      status?: "active" | "suspended" | "deleted";
      sendPasswordReset?: boolean;
      monthlyCostCapUsd?: number | null;
    },
    okNote: string,
  ) {
    setBusy(true);
    setNote(null);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(username)}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Update failed");
        return;
      }
      setNote(okNote);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  function canMutateUser(u: DirectoryUser): boolean {
    if (u.isOwner || u.role === "super_admin") return isOwnerActor;
    return true;
  }

  const refreshing = overviewLoading || usersLoading;

  if (overviewLoading && !labeledOverview && !error) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        Loading admin console…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Directory, roles, and monthly cost caps. Super Admin protections stay enforced.
      </p>

      {(error || note) && (
        <p
          role="status"
          className={cn(
            "text-[0.78rem] rounded-lg border px-3 py-2",
            error
              ? "text-destructive border-[var(--destructive-border)] bg-[var(--destructive-soft)]"
              : "text-success border-[var(--success-border)] bg-[var(--success-soft)]",
          )}
        >
          {error ?? note}
        </p>
      )}

      {/* Spend limits strip */}
      {cognitoAvailable && spendLeaders.length > 0 && (
        <section className="rounded-xl border border-border bg-card p-4 space-y-3 shadow-[var(--shadow-sm)]">
          <h3 className="text-sm font-semibold text-foreground">Monthly cost cap (UTC)</h3>
          <p className="text-[0.65rem] text-[var(--text-subtle)]">
            Estimates. Warnings at 50% and 80%; billable external calls pause at 100%.
          </p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {spendLeaders.map(u => (
              <li
                key={u.username}
                className="rounded-lg border border-border bg-secondary/40 px-3 py-2 flex items-center justify-between gap-2"
              >
                <span className="text-xs font-medium text-foreground truncate">
                  {u.email ?? u.username}
                </span>
                <SpendMeter spent={u.spent} cap={u.cap} compact />
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Org dashboard */}
      <section className="rounded-xl border border-border bg-card p-4 space-y-3 shadow-[var(--shadow-sm)]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Shield className="size-4 text-[var(--primary-soft-foreground)]" aria-hidden />
            <h3 className="text-sm font-semibold text-foreground">Centralized Insights</h3>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={range}
              onChange={e => setRange(e.target.value as AnalyticsRange)}
              className="h-8 rounded-lg border border-border bg-background px-2 text-xs text-foreground"
              aria-label="Date range"
            >
              {RANGES.map(r => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={refreshing || busy}
              className="inline-flex items-center gap-1.5 h-8 rounded-lg border border-border bg-secondary px-2.5 text-xs font-medium text-foreground hover:bg-[var(--surface-hover)] cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} aria-hidden />
              Refresh
            </button>
          </div>
        </div>

        {labeledOverview && (
          <>
            {overviewLoading && (
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Loader2 className="size-3 animate-spin" aria-hidden />
                Updating activity…
              </p>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Stat label="Directory users" value={String(labeledOverview.directoryUserCount)} />
              <Stat label="Active in range" value={String(labeledOverview.usersWithActivity)} />
              <Stat label="Workspaces" value={String(labeledOverview.workspaceCount)} />
              <Stat label="Documents" value={String(labeledOverview.documentCount)} />
              <Stat label="AI requests" value={String(labeledOverview.inferenceRequests)} />
              <Stat label="Est. cost" value={`${fmtUsd(labeledOverview.estimatedCostUsd)} USD`} />
              <Stat label="Security events" value={String(labeledOverview.securityEvents)} />
              <Stat label="High-risk blocked" value={String(labeledOverview.highRiskBlocked)} />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <input
                type="search"
                value={userQuery}
                onChange={e => setUserQuery(e.target.value)}
                placeholder="Search users…"
                aria-label="Search users in rollup"
                className="h-8 min-w-[12rem] flex-1 rounded-lg border border-border bg-background px-2.5 text-xs text-foreground placeholder:text-muted-foreground"
              />
              <label className="text-[0.65rem] text-muted-foreground flex items-center gap-1.5">
                Sort
                <select
                  value={userSort}
                  onChange={e => setUserSort(e.target.value as UserSortKey)}
                  className="h-8 rounded-lg border border-border bg-background px-2 text-xs text-foreground"
                >
                  <option value="inferenceRequests">Requests</option>
                  <option value="estimatedCostUsd">Cost</option>
                  <option value="securityEvents">Security</option>
                  <option value="label">Name</option>
                </select>
              </label>
            </div>

            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-xs text-left">
                <caption className="sr-only">Per-user activity</caption>
                <thead className="bg-muted text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">User</th>
                    <th className="px-3 py-2 font-medium tabular-nums">Workspaces</th>
                    <th className="px-3 py-2 font-medium tabular-nums">Docs</th>
                    <th className="px-3 py-2 font-medium tabular-nums">Requests</th>
                    <th className="px-3 py-2 font-medium tabular-nums">Cost</th>
                    <th className="px-3 py-2 font-medium tabular-nums">Security</th>
                    <th className="px-3 py-2 font-medium text-right">Insights</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredByUser.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-3 py-4 text-muted-foreground">
                        {labeledOverview.byUser.length === 0
                          ? "No activity in this range yet."
                          : "No users match this search."}
                      </td>
                    </tr>
                  ) : (
                    filteredByUser.map(row => (
                      <tr key={row.userId} className="border-t border-border hover:bg-foreground/[0.03]">
                        <td className="px-3 py-2 text-foreground font-medium">
                          {row.label}
                          <span className="block font-mono text-[0.58rem] text-[var(--text-subtle)]">
                            {row.userId === "local" ? "local" : row.userId.slice(0, 12)}
                          </span>
                        </td>
                        <td className="px-3 py-2 tabular-nums text-[var(--text-secondary)]">{row.workspaces}</td>
                        <td className="px-3 py-2 tabular-nums text-[var(--text-secondary)]">{row.documents}</td>
                        <td className="px-3 py-2 tabular-nums text-[var(--text-secondary)]">{row.inferenceRequests}</td>
                        <td className="px-3 py-2 tabular-nums text-[var(--text-secondary)]">{fmtUsd(row.estimatedCostUsd)} USD</td>
                        <td className="px-3 py-2 tabular-nums text-[var(--text-secondary)]">{row.securityEvents}</td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            disabled={!onOpenUserInsights}
                            onClick={() =>
                              onOpenUserInsights?.({
                                userId: row.userId,
                                label: row.label,
                                email: row.email,
                              })
                            }
                            className={cn(
                              "inline-flex items-center gap-1 rounded-md border border-indigo-500/30 bg-indigo-500/10",
                              "px-2 py-1 text-[0.65rem] font-medium text-indigo-200/90",
                              "hover:bg-indigo-500/20 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed",
                            )}
                            title={`Open Insights for ${row.label}`}
                          >
                            <BarChart2 className="size-3" aria-hidden />
                            View
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <p className="text-[0.65rem] text-[var(--text-subtle)] leading-relaxed">
              Per-user Insights in the right rail remain private to each account. Use{" "}
              <span className="text-foreground/50">View</span> for the admin-only drill-down — the same
              Usage, Cost, and Security dashboards, scoped to that member.
            </p>
          </>
        )}
      </section>

      {/* User directory */}
      <section className="rounded-xl border border-border bg-card p-4 space-y-3 shadow-[var(--shadow-sm)]">
        <div className="flex items-center gap-2">
          <Users className="size-4 text-[var(--primary-soft-foreground)]" aria-hidden />
          <h3 className="text-sm font-semibold text-foreground">Users &amp; roles</h3>
        </div>

        {!cognitoAvailable && (
          <p className="text-[0.75rem] text-[var(--warning)] leading-relaxed rounded-lg border border-[var(--warning-border)] bg-[var(--warning-soft)] px-3 py-2">
            {directoryError
              ?? "Cognito is not configured. Run npm run floci:cognito (or point at a real pool) to manage users here."}
          </p>
        )}

        {cognitoAvailable && (
          <form onSubmit={createUser} className="rounded-lg border border-dashed border-border bg-secondary/40 p-3 space-y-2.5">
            <p className="text-[0.65rem] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5">
              <UserPlus className="size-3.5" aria-hidden />
              Create user
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block text-xs text-muted-foreground">
                Email
                <input
                  type="email"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="mt-1 w-full h-9 rounded-lg border border-border bg-card px-3 text-sm text-foreground"
                  placeholder="analyst@example.com"
                />
              </label>
              <label className="block text-xs text-muted-foreground">
                Temporary password
                <input
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="mt-1 w-full h-9 rounded-lg border border-border bg-card px-3 text-sm text-foreground"
                  placeholder="At least 8 characters"
                />
              </label>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <label className="block text-xs text-muted-foreground">
                Role
                <select
                  value={newRole}
                  onChange={e => setNewRole(e.target.value as AssignableRole)}
                  className="mt-1 block h-9 rounded-lg border border-border bg-card px-2 text-sm text-foreground"
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
              </label>
              <div className="block text-xs text-muted-foreground space-y-1">
                <span>Monthly cost cap (USD)</span>
                <div className="flex flex-wrap gap-1.5">
                  {CAP_PRESETS.map(p => (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => {
                        setNewCap(p.value);
                        setCustomCap("");
                      }}
                      className={cn(
                        "h-8 rounded-md border px-2 text-[0.7rem] font-medium cursor-pointer",
                        newCap === p.value && customCap === ""
                          ? "border-primary bg-primary/15 text-foreground"
                          : "border-border bg-card text-muted-foreground hover:bg-[var(--surface-hover)]",
                      )}
                    >
                      {p.label}
                    </button>
                  ))}
                  <input
                    type="number"
                    min={0.01}
                    step={0.01}
                    placeholder="Custom"
                    value={customCap}
                    onChange={e => setCustomCap(e.target.value)}
                    className="h-8 w-24 rounded-md border border-border bg-card px-2 text-sm text-foreground"
                    aria-label="Custom monthly cap USD"
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={busy}
                className="h-9 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-[var(--primary-hover)] disabled:opacity-50 cursor-pointer"
              >
                Create account
              </button>
            </div>
            <p className="text-[0.65rem] text-[var(--text-subtle)] leading-relaxed">
              Default cap is {fmtUsdLabeled(defaultCap)}.{" "}
              {mailConfigured
                ? "A welcome email is sent on create (sign-in link + role only — never the password)."
                : "Welcome email is off until SMTP is set in .env.local (SMTP_HOST, MAIL_FROM). The password is never emailed."}
            </p>
          </form>
        )}

        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-xs text-left">
            <caption className="sr-only">Directory users</caption>
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Email</th>
                <th className="px-3 py-2 font-medium">Role</th>
                <th className="px-3 py-2 font-medium">MTD / Cap</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-muted-foreground">
                    {cognitoAvailable ? "No users returned from the pool." : "Directory unavailable."}
                  </td>
                </tr>
              ) : (
                users.map(u => {
                  const mutable = canMutateUser(u);
                  return (
                    <tr key={u.username} className="border-t border-border">
                      <td className="px-3 py-2.5">
                        <span className="font-medium text-foreground">{u.email ?? u.username}</span>
                        <span className="block text-[0.58rem] text-[var(--text-subtle)]">{u.status}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={cn(
                            "inline-flex rounded border px-1.5 py-0.5 text-[0.6rem] uppercase tracking-wide font-semibold",
                            u.role === "super_admin"
                              ? "bg-[var(--warning-soft)] border-[var(--warning-border)] text-[var(--warning)]"
                              : u.role === "admin"
                                ? "bg-[var(--primary-soft)] border-[var(--primary-border)] text-[var(--primary-soft-foreground)]"
                                : "bg-secondary border-border text-muted-foreground",
                          )}
                        >
                          {u.role === "super_admin" ? "Super Admin" : u.role === "admin" ? "Admin" : "Member"}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <SpendMeter
                          spent={u.monthSpendUsd ?? 0}
                          cap={u.monthlyCostCapUsd}
                          compact
                        />
                        {mutable && (
                          <>
                          <select
                            className="mt-1 h-7 rounded border border-border bg-card px-1 text-[0.65rem] text-foreground"
                            disabled={busy}
                            value={
                              rowCustomCap?.username === u.username
                                ? "custom"
                                : u.monthlyCostCapUsd == null
                                  ? "unlimited"
                                  : String(u.monthlyCostCapUsd)
                            }
                            onChange={e => {
                              const v = e.target.value;
                              if (v === "custom") {
                                setRowCustomCap({
                                  username: u.username,
                                  value: u.monthlyCostCapUsd != null ? String(u.monthlyCostCapUsd) : "",
                                });
                                return;
                              }
                              setRowCustomCap(null);
                              const cap = v === "unlimited" ? null : Number(v);
                              void patchUser(
                                u.username,
                                { monthlyCostCapUsd: cap },
                                `Updated cap for ${u.email}`,
                              );
                            }}
                            aria-label={`Set cost cap for ${u.email}`}
                          >
                            <option value="5">$5 USD</option>
                            <option value="10">$10 USD</option>
                            <option value="25">$25 USD</option>
                            <option value="50">$50 USD</option>
                            <option value="unlimited">Unlimited</option>
                            <option value="custom">Custom</option>
                            {u.monthlyCostCapUsd != null
                              && ![5, 10, 25, 50].includes(u.monthlyCostCapUsd) && (
                              <option value={String(u.monthlyCostCapUsd)}>
                                {fmtUsdLabeled(u.monthlyCostCapUsd)}
                              </option>
                            )}
                          </select>
                          {rowCustomCap?.username === u.username && (
                            <form
                              className="mt-1 flex items-center gap-1"
                              onSubmit={e => {
                                e.preventDefault();
                                const parsed = parseMonthlyCostCapInput(rowCustomCap.value);
                                if (!parsed.ok || parsed.value == null) {
                                  setError(parsed.ok ? "Enter a custom USD amount greater than zero." : parsed.error);
                                  return;
                                }
                                void patchUser(
                                  u.username,
                                  { monthlyCostCapUsd: parsed.value },
                                  `Updated cap for ${u.email}`,
                                );
                                setRowCustomCap(null);
                              }}
                            >
                              <input
                                type="number"
                                min={0.01}
                                step={0.01}
                                value={rowCustomCap.value}
                                onChange={e => setRowCustomCap({ username: u.username, value: e.target.value })}
                                className="h-7 w-24 rounded border border-border bg-card px-1.5 text-[0.65rem]"
                                aria-label={`Custom monthly cost cap for ${u.email}`}
                                placeholder="USD"
                              />
                              <button type="submit" className="h-7 rounded border border-border px-1.5 text-[0.62rem]">
                                Set
                              </button>
                            </form>
                          )}
                          </>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-[var(--text-secondary)]">
                        {u.enabled ? "Enabled" : "Disabled"}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap gap-1.5">
                          {u.role === "member" ? (
                            <button
                              type="button"
                              disabled={busy || !u.enabled || !mutable}
                              onClick={() =>
                                setConfirm({
                                  title: "Promote member to Admin?",
                                  identity: u.email ?? u.username,
                                  currentRole: "Member",
                                  newRole: "Admin",
                                  impact: `${u.email ?? u.username} will be able to manage users, workspaces, model providers, credentials, and account settings.`,
                                  confirmLabel: "Make Admin",
                                  run: () =>
                                    patchUser(u.username, { role: "admin" }, `${u.email} is now an admin`),
                                })
                              }
                              className="rounded-md border border-border bg-secondary px-2 py-1 text-[0.65rem] font-medium hover:bg-[var(--surface-hover)] cursor-pointer disabled:opacity-40"
                            >
                              Make admin
                            </button>
                          ) : u.role === "admin" ? (
                            <button
                              type="button"
                              disabled={busy || !mutable}
                              onClick={() =>
                                setConfirm({
                                  title: "Change Admin to Member?",
                                  identity: u.email ?? u.username,
                                  currentRole: "Admin",
                                  newRole: "Member",
                                  impact: `${u.email ?? u.username} will lose administrative access and retain only permitted workspace capabilities.`,
                                  confirmLabel: "Make Member",
                                  run: () =>
                                    patchUser(u.username, { role: "member" }, `${u.email} is now a member`),
                                })
                              }
                              className="rounded-md border border-border bg-secondary px-2 py-1 text-[0.65rem] font-medium hover:bg-[var(--surface-hover)] cursor-pointer disabled:opacity-40"
                            >
                              Make member
                            </button>
                          ) : (
                            <span className="text-[0.65rem] text-muted-foreground px-1 py-1">
                              Protected
                            </span>
                          )}
                          <button
                            type="button"
                            disabled={busy || !mutable}
                            onClick={() =>
                              setConfirm({
                                title: u.enabled ? "Suspend user?" : "Reactivate user?",
                                identity: u.email ?? u.username,
                                currentRole: u.enabled ? "Enabled" : "Disabled",
                                newRole: u.enabled ? "Suspended" : "Active",
                                impact: u.enabled
                                  ? `${u.email ?? u.username} will lose sign-in access until reactivated.`
                                  : `${u.email ?? u.username} will be able to sign in again.`,
                                confirmLabel: u.enabled ? "Suspend" : "Reactivate",
                                destructive: u.enabled,
                                run: () =>
                                  patchUser(
                                    u.username,
                                    { enabled: !u.enabled, status: u.enabled ? "suspended" : "active" },
                                    u.enabled ? `Suspended ${u.email}` : `Reactivated ${u.email}`,
                                  ),
                              })
                            }
                            className="rounded-md border border-border bg-card px-2 py-1 text-[0.65rem] font-medium hover:bg-[var(--surface-hover)] cursor-pointer disabled:opacity-40"
                          >
                            {u.enabled ? "Suspend" : "Reactivate"}
                          </button>
                          {u.enabled && (
                            <button
                              type="button"
                              disabled={busy || !mutable}
                              onClick={() =>
                                setConfirm({
                                  title: "Soft-delete user?",
                                  identity: u.email ?? u.username,
                                  impact: `${u.email ?? u.username} will be disabled in Cognito. Workspace and audit data stay until a future purge.`,
                                  confirmLabel: "Soft-delete",
                                  destructive: true,
                                  run: () =>
                                    patchUser(u.username, { status: "deleted" }, `Marked ${u.email} deleted (soft)`),
                                })
                              }
                              className="rounded-md border border-[var(--destructive-border)] bg-[var(--destructive-soft)] px-2 py-1 text-[0.65rem] font-semibold text-destructive hover:brightness-95 cursor-pointer disabled:opacity-40"
                            >
                              Soft-delete
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={busy || !mutable}
                            onClick={() =>
                              setConfirm({
                                title: "Send password reset?",
                                identity: u.email ?? u.username,
                                impact: `A password reset will be sent for ${u.email ?? u.username}. Existing sessions may be invalidated.`,
                                confirmLabel: "Send reset",
                                run: () =>
                                  patchUser(
                                    u.username,
                                    { sendPasswordReset: true },
                                    `Password reset sent for ${u.email}`,
                                  ),
                              })
                            }
                            className="rounded-md border border-border bg-card px-2 py-1 text-[0.65rem] font-medium hover:bg-[var(--surface-hover)] cursor-pointer disabled:opacity-40"
                          >
                            Reset password
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <p className="text-[0.65rem] text-[var(--text-subtle)] leading-relaxed">
          Soft-delete disables sign-in and marks the profile deleted. Data stays until a future purge.
        </p>
      </section>

      {confirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-confirm-title"
        >
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-4 space-y-3 shadow-lg">
            <h4 id="admin-confirm-title" className="text-sm font-semibold text-foreground">
              {confirm.title}
            </h4>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[0.75rem]">
              <dt className="text-muted-foreground">User</dt>
              <dd className="text-foreground">{confirm.identity}</dd>
              {confirm.currentRole && (
                <>
                  <dt className="text-muted-foreground">Current</dt>
                  <dd>{confirm.currentRole}</dd>
                </>
              )}
              {confirm.newRole && (
                <>
                  <dt className="text-muted-foreground">New</dt>
                  <dd>{confirm.newRole}</dd>
                </>
              )}
            </dl>
            <p className="text-[0.75rem] text-muted-foreground leading-relaxed">{confirm.impact}</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirm(null)}
                className="h-8 rounded-lg border border-border px-3 text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const run = confirm.run;
                  setConfirm(null);
                  void run();
                }}
                className={cn(
                  "h-8 rounded-lg px-3 text-xs font-semibold",
                  confirm.destructive
                    ? "bg-[var(--destructive-soft)] text-destructive border border-[var(--destructive-border)]"
                    : "bg-primary text-primary-foreground",
                )}
              >
                {confirm.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-secondary/50 px-3 py-2.5">
      <p className="text-[0.62rem] uppercase tracking-wide text-muted-foreground font-medium">{label}</p>
      <p className="text-lg font-semibold text-foreground tabular-nums mt-0.5">{value}</p>
    </div>
  );
}
