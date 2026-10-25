"use client";

import {
  BarChart2,
  ChevronDown,
  ChevronRight,
  Cpu,
  LayoutGrid,
  LogOut,
  Palette,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  UserCircle,
  Users,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { formatUsd } from "@/lib/cost-cap-shared";
import { cn } from "@/lib/utils";
import { AppearanceSettings } from "@/components/app/appearance-settings";
import { InferenceSettings } from "@/components/app/inference-settings";
import type { ComplexityTiersBind } from "@/components/app/complexity-tiers-editor";
import { AdminConsole } from "@/components/app/admin-console";
import { ProfileSettings } from "@/components/app/profile-settings";
import { AdminOnlyNotice } from "@/components/app/admin-only-notice";
import {
  NON_EXEMPTIBLE_CATEGORIES,
  categoryLabel,
  isShippedDefaultSafeTerm,
  type PiiSensitivityTier,
  type SafeTerm,
  type SafeTermKind,
} from "@/lib/pii";
import {
  DetectionForwardOnlyNotice,
  DetectionPolicyExplainer,
  DetectionPolicyMatrix,
} from "@/components/app/detection-policy-panel";

export type SettingsSection =
  | "overview"
  | "insights-context"
  | "insights-savings"
  | "insights-security"
  | "profile"
  | "account-security"
  | "appearance"
  | "workspace"
  | "inference"
  | "providers"
  | "admin";

export const SETTINGS_SECTION_KEY = "sm_settings_section";

export const SETTINGS_SECTION_LABELS: Record<SettingsSection, string> = {
  overview:           "Overview",
  "insights-context": "Usage",
  "insights-savings": "Cost",
  "insights-security":"Security",
  profile:            "Profile",
  /** Password and two-step verification. Was a tab inside Profile. */
  "account-security": "Account security",
  appearance:         "Appearance",
  /** Detection sensitivity and safe terms. The id stays `workspace` for saved links. */
  workspace:          "Detection",
  /** Connections, catalog, and complexity tiers. Keep this id: Insights and localStorage already use it. */
  inference:          "Models",
  /** Older deep links. Renders the Models page; Connections opens at the top. */
  providers:          "Models",
  /** Directory, roles, and spend caps. The id stays `admin` for saved links. */
  admin:              "Admin",
};

/** Mobile picker order. Matches the sidebar: account, reports, then setup. */
const MOBILE_SECTION_ORDER: SettingsSection[] = [
  "overview",
  "profile",
  "account-security",
  "appearance",
  "insights-context",
  "insights-savings",
  "insights-security",
  "inference",
  "workspace",
  "admin",
];

const SETTINGS_NAV_GROUP_KEY = "sm_settings_nav_groups";

export function isSettingsSection(v: string): v is SettingsSection {
  return v in SETTINGS_SECTION_LABELS;
}

const SAFE_TERM_KINDS: { kind: SafeTermKind; label: string; placeholder: string }[] = [
  { kind: "cidr",    label: "IP range",  placeholder: "10.0.0.0/8" },
  { kind: "domain",  label: "Domain",    placeholder: "*.internal.acme.com" },
  { kind: "prefix",  label: "Prefix",    placeholder: "arn:aws:s3:::acme-logs-*" },
  { kind: "literal", label: "Exact text", placeholder: "svc-payments-prod" },
];

/**
 * Declared exemptions. These are matched BEFORE detection, so nothing is ever
 * exposed after the fact — a safe term stops a value being treated as sensitive
 * in the first place.
 */
const SAFE_TERMS_PAGE_SIZE = 10;

function SafeTermsSection({
  safeTerms,
  onAdd,
  onRemove,
  readOnly = false,
}: {
  safeTerms: SafeTerm[];
  onAdd: (kind: SafeTermKind, value: string, label?: string) =>
    { ok: true } | { ok: false; reason: string };
  onRemove: (id: string) => void;
  readOnly?: boolean;
}) {
  const [kind, setKind]   = useState<SafeTermKind>("cidr");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  const active = SAFE_TERM_KINDS.find(k => k.kind === kind)!;
  const shippedTerms = safeTerms.filter(isShippedDefaultSafeTerm);
  const customTerms = safeTerms.filter(t => !isShippedDefaultSafeTerm(t));
  const pageCount = Math.max(1, Math.ceil(customTerms.length / SAFE_TERMS_PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageStart = safePage * SAFE_TERMS_PAGE_SIZE;
  const pageTerms = customTerms.slice(pageStart, pageStart + SAFE_TERMS_PAGE_SIZE);
  const showPager = customTerms.length > SAFE_TERMS_PAGE_SIZE;

  useEffect(() => {
    if (page > pageCount - 1) setPage(Math.max(0, pageCount - 1));
  }, [page, pageCount]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (readOnly) return;
    const result = onAdd(kind, value);
    if (!result.ok) { setError(result.reason); return; }
    setValue("");
    setError(null);
    // New term appends to the end — show the last page after the list grows.
    setPage(Math.floor(customTerms.length / SAFE_TERMS_PAGE_SIZE));
  }

  return (
    <div>
      <h3 className="text-section mb-1.5">Safe terms</h3>
      <p className="text-xs text-foreground/35 mb-3 leading-relaxed">
        Declared exemptions matched before detection on new chat sends and new Knowledge
        ingest. A category can still be “on” at this tier while a matching exemption
        lets a specific value through. Instance policy is Admin-owned (stored server-side).
        Shipped documentation names (<code className="font-mono text-foreground/45">example.com</code>,
        reserved TLDs) are listed first so demos do not treat fake mailboxes as real people.
      </p>

      {!readOnly && (
      <form onSubmit={submit} className="space-y-2 mb-3">
        <div className="flex flex-wrap gap-1.5">
          {SAFE_TERM_KINDS.map(k => (
            <button
              key={k.kind}
              type="button"
              onClick={() => { setKind(k.kind); setError(null); }}
              className={cn(
                "rounded-lg border px-2.5 py-1 text-[0.65rem] font-medium transition-colors cursor-pointer",
                kind === k.kind
                  ? "border-indigo-500/40 bg-indigo-500/15 text-indigo-200/90"
                  : "border-foreground/10 bg-foreground/[0.03] text-foreground/45 hover:text-foreground/70",
              )}
            >
              {k.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={value}
            onChange={e => { setValue(e.target.value); setError(null); }}
            placeholder={active.placeholder}
            spellCheck={false}
            autoComplete="off"
            className="flex-1 min-w-0 h-9 rounded-lg border border-foreground/10 bg-foreground/[0.04] px-3 text-xs font-mono text-foreground/70 placeholder:text-foreground/25 focus:outline-none focus:ring-1 focus:ring-indigo-500/40"
          />
          <button
            type="submit"
            disabled={!value.trim()}
            className="shrink-0 rounded-lg bg-indigo-500/20 border border-indigo-500/30 px-3 py-1.5 text-[0.68rem] font-medium text-indigo-200/90 hover:bg-indigo-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
          >
            Add
          </button>
        </div>
        {error && (
          <p role="alert" className="text-[0.65rem] text-red-300/90">{error}</p>
        )}
        <p className="text-[0.6rem] text-foreground/28 leading-relaxed">
          {NON_EXEMPTIBLE_CATEGORIES.map(categoryLabel).join(" and ")} cannot be added as
          safe terms. When those patterns match, they are replaced and cannot be exempted.
        </p>
      </form>
      )}
      {readOnly && (
        <AdminOnlyNotice compact className="mb-3">
          Safe terms are applied by an Admin. You can propose a change below and an Admin will review it.
        </AdminOnlyNotice>
      )}

      {shippedTerms.length > 0 && (
        <div className="mb-3">
          <p className="text-[0.58rem] uppercase tracking-wider text-foreground/30 font-semibold mb-1.5">
            Shipped — documentation &amp; non-routable
          </p>
          <ul className="space-y-1.5">
            {shippedTerms.map(t => (
              <li
                key={t.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-indigo-500/15 bg-indigo-500/[0.06] px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="rounded-md bg-indigo-500/15 border border-indigo-400/20 px-1.5 py-0.5 text-[0.55rem] uppercase tracking-wider text-indigo-200/80">
                      Shipped
                    </span>
                    <span className="text-[0.58rem] uppercase tracking-wider text-foreground/30">
                      {SAFE_TERM_KINDS.find(k => k.kind === t.kind)?.label ?? t.kind}
                    </span>
                    <code className="text-[0.72rem] font-mono text-foreground/70 break-all">{t.value}</code>
                  </div>
                  {t.label && <p className="text-[0.6rem] text-foreground/35 mt-0.5">{t.label}</p>}
                </div>
                {!readOnly && (
                <button
                  type="button"
                  onClick={() => onRemove(t.id)}
                  aria-label={`Remove safe term ${t.value}`}
                  className="shrink-0 rounded-md border border-[var(--destructive-border)] bg-[var(--destructive-soft)] px-2.5 py-1 text-[0.62rem] font-semibold text-destructive hover:brightness-95 transition-colors cursor-pointer"
                >
                  Remove
                </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {customTerms.length > 0 && (
        <p className="text-[0.58rem] uppercase tracking-wider text-foreground/30 font-semibold mb-1.5">
          Added on this instance
        </p>
      )}
      <ul className="space-y-1.5">
        {pageTerms.map(t => (
          <li
            key={t.id}
            className="flex items-center justify-between gap-3 rounded-xl border border-foreground/[0.07] bg-foreground/[0.03] px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[0.58rem] uppercase tracking-wider text-foreground/30">
                  {SAFE_TERM_KINDS.find(k => k.kind === t.kind)?.label ?? t.kind}
                </span>
                <code className="text-[0.72rem] font-mono text-foreground/70 break-all">{t.value}</code>
              </div>
              {t.label && <p className="text-[0.6rem] text-foreground/25 mt-0.5">{t.label}</p>}
            </div>
            {!readOnly && (
            <button
              type="button"
              onClick={() => onRemove(t.id)}
              aria-label={`Remove safe term ${t.value}`}
              className="shrink-0 rounded-md border border-[var(--destructive-border)] bg-[var(--destructive-soft)] px-2.5 py-1 text-[0.62rem] font-semibold text-destructive hover:brightness-95 transition-colors cursor-pointer"
            >
              Remove
            </button>
            )}
          </li>
        ))}
      </ul>
      {showPager && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[0.62rem] text-foreground/35 tabular-nums">
            Page {safePage + 1} of {pageCount} · {customTerms.length} added
          </p>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={safePage <= 0}
              onClick={() => setPage(p => Math.max(0, p - 1))}
              className="rounded-lg border border-foreground/12 px-2.5 py-1 text-[0.65rem] text-foreground/60 hover:bg-foreground/[0.06] disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer"
            >
              Prev
            </button>
            <button
              type="button"
              disabled={safePage >= pageCount - 1}
              onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))}
              className="rounded-lg border border-foreground/12 px-2.5 py-1 text-[0.65rem] text-foreground/60 hover:bg-foreground/[0.06] disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

type SavingsStats = {
  totalCost: number;
  totalSaved: number;
  responseCount: number;
  monthSpentUsd?: number;
  monthCapUsd?: number | null;
  monthResetsAt?: string;
};

function fmtUsd(d: number): string {
  return formatUsd(d);
}

function fmtUsdLabeledLocal(d: number | null | undefined): string {
  if (d == null) return "Unlimited";
  return `${fmtUsd(d)} USD`;
}

function NavItem({
  active,
  onClick,
  icon: Icon,
  label,
  indent,
  compact,
  emphasize,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof LayoutGrid;
  label: string;
  indent?: boolean;
  compact?: boolean;
  /** Slightly stronger chrome for high-traffic destinations (e.g. Models). */
  emphasize?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg text-left transition-colors cursor-pointer",
        compact ? "py-1.5 text-[0.8125rem]" : "py-2 text-sm",
        indent ? "pl-7 pr-2" : "px-2",
        active
          ? "bg-[var(--surface-selected)] text-[var(--primary-soft-foreground)] font-medium shadow-[inset_0_0_0_1px_var(--primary-border)] dark:bg-foreground/[0.09] dark:text-foreground/90 dark:shadow-none"
          : emphasize
            ? "text-foreground/70 hover:bg-[var(--surface-hover)] hover:text-foreground dark:text-foreground/65 dark:hover:bg-foreground/[0.05]"
            : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-foreground dark:text-foreground/45 dark:hover:bg-foreground/[0.05] dark:hover:text-foreground/70",
      )}
    >
      <Icon
        className={cn(
          "size-4 shrink-0",
          active
            ? "text-[var(--primary)] dark:text-foreground/90"
            : emphasize
              ? "text-[var(--primary)]/80 dark:text-violet-300/80"
              : "text-foreground/55 dark:text-foreground/55",
        )}
        aria-hidden
      />
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}

function readNavGroupOpen(id: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(SETTINGS_NAV_GROUP_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Record<string, boolean>;
    if (typeof parsed[id] === "boolean") return parsed[id];
  } catch {
    /* ignore */
  }
  return fallback;
}

function writeNavGroupOpen(id: string, open: boolean) {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(SETTINGS_NAV_GROUP_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
    parsed[id] = open;
    localStorage.setItem(SETTINGS_NAV_GROUP_KEY, JSON.stringify(parsed));
  } catch {
    /* ignore */
  }
}

/** Collapsible settings nav group — open by default; preference remembered. */
function NavGroup({
  id,
  label,
  children,
  defaultOpen = true,
  forceOpen = false,
}: {
  id: string;
  label: string;
  children: ReactNode;
  defaultOpen?: boolean;
  /** Keep expanded while a child route is active (still allows manual collapse after). */
  forceOpen?: boolean;
}) {
  const [open, setOpen] = useState(() => readNavGroupOpen(id, defaultOpen));

  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);

  function toggle() {
    setOpen(prev => {
      const next = !prev;
      writeNavGroupOpen(id, next);
      return next;
    });
  }

  return (
    <div className="pt-2">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-2 py-1 rounded-md text-left cursor-pointer hover:bg-foreground/[0.04] transition-colors"
      >
        <span className="text-[0.58rem] uppercase tracking-wider text-foreground/28 font-semibold">
          {label}
        </span>
        <ChevronDown
          className={cn(
            "size-3 shrink-0 text-foreground/25 transition-transform",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>
      {open && <div className="space-y-0.5 mt-0.5">{children}</div>}
    </div>
  );
}

/** Settings sub-nav — lives in the left sidebar when Settings mode is active. */
export type InsightsDashboard = "usage" | "cost" | "security";

export function SettingsSidebarNav({
  section,
  onSectionChange,
  onOpenInsightsDashboard,
  activeInsightsDashboard = null,
  isAdmin = false,
  onSignOut,
}: {
  section: SettingsSection;
  onSectionChange: (s: SettingsSection) => void;
  /** Opens the full Usage / Cost / Security analytics views. */
  onOpenInsightsDashboard: (view: InsightsDashboard, hash?: string) => void;
  /** Which full dashboard is currently showing (highlights the matching nav item). */
  activeInsightsDashboard?: InsightsDashboard | null;
  /** Cognito Admin group (or local auth). Multiple admins are supported. */
  isAdmin?: boolean;
  /** Cognito session sign-out — pinned to the bottom of this nav. */
  onSignOut?: () => void;
}) {
  const insightsActive = Boolean(activeInsightsDashboard) ||
    section === "insights-context" ||
    section === "insights-savings" ||
    section === "insights-security";
  const preferencesActive = section === "profile" || section === "account-security" || section === "appearance";
  const setupActive =
    section === "inference" ||
    section === "providers" ||
    section === "workspace" ||
    (section === "admin" && !activeInsightsDashboard);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <nav
        aria-label="Settings sections"
        className="min-h-0 flex-1 overflow-y-auto px-1 pt-1 pb-1 space-y-0.5"
      >
      <NavItem
        active={section === "overview" && !activeInsightsDashboard}
        onClick={() => onSectionChange("overview")}
        icon={LayoutGrid}
        label="Overview"
        compact
      />

      <NavGroup id="preferences" label="Preferences" forceOpen={preferencesActive}>
        <NavItem
          active={section === "profile"}
          onClick={() => onSectionChange("profile")}
          icon={UserCircle}
          label="Profile"
          indent
          compact
        />
        <NavItem
          active={section === "account-security"}
          onClick={() => onSectionChange("account-security")}
          icon={ShieldCheck}
          label="Account security"
          indent
          compact
        />
        <NavItem
          active={section === "appearance"}
          onClick={() => onSectionChange("appearance")}
          icon={Palette}
          label="Appearance"
          indent
          compact
        />
      </NavGroup>

      <NavGroup id="insights" label="Insights" forceOpen={insightsActive}>
        <NavItem
          active={activeInsightsDashboard === "usage" || (!activeInsightsDashboard && section === "insights-context")}
          onClick={() => onOpenInsightsDashboard("usage")}
          icon={Sparkles}
          label="Usage"
          indent
          compact
        />
        <NavItem
          active={activeInsightsDashboard === "cost" || (!activeInsightsDashboard && section === "insights-savings")}
          onClick={() => onOpenInsightsDashboard("cost")}
          icon={BarChart2}
          label="Cost"
          indent
          compact
        />
        <NavItem
          active={activeInsightsDashboard === "security" || (!activeInsightsDashboard && section === "insights-security")}
          onClick={() => onOpenInsightsDashboard("security")}
          icon={Shield}
          label="Security"
          indent
          compact
        />
      </NavGroup>

      <NavGroup id="setup" label="Setup" forceOpen={setupActive}>
        <NavItem
          active={section === "inference" || section === "providers"}
          onClick={() => onSectionChange("inference")}
          icon={Cpu}
          label="Models"
          indent
          compact
        />
        <NavItem
          active={section === "workspace"}
          onClick={() => onSectionChange("workspace")}
          icon={SlidersHorizontal}
          label="Detection"
          indent
          compact
        />
        {isAdmin && (
          <NavItem
            active={section === "admin" && !activeInsightsDashboard}
            onClick={() => onSectionChange("admin")}
            icon={Users}
            label="Admin"
            indent
            compact
          />
        )}
      </NavGroup>
      </nav>
      {onSignOut && (
        <div className="shrink-0 border-t border-foreground/8 px-1 pt-1.5 pb-0.5">
          <button
            type="button"
            onClick={onSignOut}
            className={cn(
              "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[0.8125rem] cursor-pointer",
              "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-foreground",
              "dark:text-foreground/45 dark:hover:bg-foreground/[0.05] dark:hover:text-foreground/70",
            )}
          >
            <LogOut className="size-4 shrink-0 text-foreground/55" aria-hidden />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function OverviewCard({
  title,
  description,
  stat,
  accent,
  onClick,
}: {
  title: string;
  description: string;
  stat?: string;
  accent: "indigo" | "emerald" | "amber";
  onClick: () => void;
}) {
  const accentBorder = {
    indigo: "border-indigo-500/25 hover:border-indigo-500/40",
    emerald: "border-emerald-500/25 hover:border-emerald-500/40",
    amber: "border-amber-500/25 hover:border-amber-500/40",
  }[accent];
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full text-left rounded-xl border bg-foreground/[0.03] px-4 py-3.5 transition-colors cursor-pointer group",
        accentBorder,
        "hover:bg-foreground/[0.05]",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-ui font-medium text-foreground/80">{title}</p>
          <p className="text-[0.65rem] text-foreground/38 mt-1 leading-relaxed">{description}</p>
        </div>
        <ChevronRight className="size-4 text-foreground/20 group-hover:text-foreground/45 shrink-0 mt-0.5 transition-colors" aria-hidden />
      </div>
      {stat && (
        <p className="text-[0.62rem] font-mono text-foreground/35 mt-2 tabular-nums">{stat}</p>
      )}
    </button>
  );
}

/** Settings content only — sub-nav is in the left sidebar. */
export type InsightsSubjectRef = {
  userId: string;
  label: string;
  email: string | null;
};

export function SettingsHub({
  section,
  onSectionChange,
  onOpenInsightsDashboard,
  onOpenUserInsights,
  safeTerms,
  onAddSafeTerm,
  onRemoveSafeTerm,
  piiSensitivity,
  onPiiSensitivityChange,
  savingsStats,
  totalRouteCalls,
  totalPiiActive,
  lastRouteLabel,
  activeMode,
  complexityTiers,
  isAdmin = false,
  canEditSecurity = false,
  securityPending = null,
  onProposeSecurity,
  onAcceptPendingSecurity,
  onDismissPendingSecurity,
  securityNotice = null,
  onProvidersChanged,
}: {
  section: SettingsSection;
  onSectionChange: (s: SettingsSection) => void;
  onOpenInsightsDashboard: (view: InsightsDashboard, hash?: string) => void;
  /** Admin console → scoped member Insights (Usage first). */
  onOpenUserInsights?: (subject: InsightsSubjectRef) => void;
  safeTerms: SafeTerm[];
  onAddSafeTerm: (kind: SafeTermKind, value: string, label?: string) =>
    { ok: true } | { ok: false; reason: string };
  onRemoveSafeTerm: (id: string) => void;
  piiSensitivity: PiiSensitivityTier;
  onPiiSensitivityChange: (tier: PiiSensitivityTier) => void;
  savingsStats: SavingsStats;
  totalRouteCalls: number;
  totalPiiActive: number;
  lastRouteLabel: string;
  activeMode: string;
  complexityTiers: ComplexityTiersBind;
  isAdmin?: boolean;
  /** Owner | Operator | Member — used for Owner-row protection in the console. */
  actorRole?: "super_admin" | "admin" | "member";
  canEditSecurity?: boolean;
  securityPending?: null | {
    piiSensitivity: PiiSensitivityTier;
    note: string | null;
    stricterThanActive: boolean;
  };
  onProposeSecurity?: (tier: PiiSensitivityTier) => void;
  onAcceptPendingSecurity?: () => void;
  onDismissPendingSecurity?: () => void;
  securityNotice?: string | null;
  /** Re-probe chatReady after Bedrock / vendor save. */
  onProvidersChanged?: () => void;
}) {
  useEffect(() => {
    if (section === "admin" && !isAdmin) {
      onSectionChange("overview");
    }
  }, [section, isAdmin, onSectionChange]);

  const mobileSections = MOBILE_SECTION_ORDER.filter(id => id !== "admin" || isAdmin);

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      {/* Mobile section picker — sidebar nav is hidden below md */}
      <div className="md:hidden shrink-0 border-b border-foreground/[0.06] px-4 py-2">
        <select
          value={section === "providers" ? "inference" : section === "admin" && !isAdmin ? "overview" : section}
          onChange={e => {
            const next = e.target.value as SettingsSection;
            if (next === "insights-context") onOpenInsightsDashboard("usage");
            else if (next === "insights-savings") onOpenInsightsDashboard("cost");
            else if (next === "insights-security") onOpenInsightsDashboard("security");
            else onSectionChange(next);
          }}
          className="w-full rounded-lg border border-foreground/10 bg-foreground/[0.04] px-3 py-2 text-sm text-foreground/75"
        >
          {mobileSections.map(id => (
            <option key={id} value={id}>{SETTINGS_SECTION_LABELS[id]}</option>
          ))}
        </select>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-6">
        <div className="max-w-7xl mx-auto flex flex-col gap-5 w-full">
          <div>
            <h2 className="text-title">
              {section === "providers" ? "Models" : SETTINGS_SECTION_LABELS[section]}
            </h2>
            {section === "overview" && (
              <p className="text-ui text-[var(--text-muted)] mt-1.5 leading-[var(--leading-body)]">
                Models, knowledge, memory, cost, and sensitive-data risk — visibility and control, not a security guarantee.
              </p>
            )}
            {(section === "inference" || section === "providers") && (
              <p className="text-ui text-[var(--text-muted)] mt-1.5 leading-[var(--leading-body)]">
                Connect a model source, then review the models it can run and how chat routes them.
              </p>
            )}
            {section === "workspace" && (
              <p className="text-ui text-[var(--text-muted)] mt-1.5 leading-[var(--leading-body)]">
                Which pattern families run before a message is sent or a file is stored. Risk reduction, not a guarantee.
              </p>
            )}
            {section === "admin" && (
              <p className="text-ui text-[var(--text-muted)] mt-1.5 leading-[var(--leading-body)]">
                Portal name and logo, then directory, roles, and monthly cost caps.
              </p>
            )}
          </div>

          {section === "overview" && (
            <div className="grid gap-2">
              <p className="text-[0.58rem] uppercase tracking-wider text-foreground/30 font-semibold">
                Preferences
              </p>
              <OverviewCard
                title="Profile"
                description="Display name, avatar preset, and account preferences."
                accent="indigo"
                onClick={() => onSectionChange("profile")}
              />
              <OverviewCard
                title="Account security"
                description="Change your password and turn on two-step verification."
                accent="indigo"
                onClick={() => onSectionChange("account-security")}
              />
              <OverviewCard
                title="Appearance"
                description="Dark or light theme for the whole application."
                accent="indigo"
                onClick={() => onSectionChange("appearance")}
              />
              <p className="text-[0.58rem] uppercase tracking-wider text-foreground/30 font-semibold pt-3">
                Insights
              </p>
              <OverviewCard
                title="Usage"
                description="Complexity routing, model tiers, and response counts."
                stat={totalRouteCalls > 0 ? `${totalRouteCalls} responses tracked` : "No data yet"}
                accent="indigo"
                onClick={() => onOpenInsightsDashboard("usage")}
              />
              <OverviewCard
                title="Cost"
                description="Spend vs monthly budget, baseline comparison, and model costs."
                stat={
                  savingsStats.monthSpentUsd != null
                    ? `${fmtUsdLabeledLocal(savingsStats.monthSpentUsd)} of ${fmtUsdLabeledLocal(savingsStats.monthCapUsd)} this month`
                    : savingsStats.responseCount > 0
                      ? `${fmtUsd(savingsStats.totalCost)} USD spent · ${fmtUsd(savingsStats.totalSaved)} saved`
                      : "No data yet"
                }
                accent="emerald"
                onClick={() => onOpenInsightsDashboard("cost")}
              />
              <OverviewCard
                title="Security"
                description="What the scanner flagged. The rules live under Setup → Detection."
                stat={totalPiiActive > 0 ? `${totalPiiActive} active detections` : "No detections"}
                accent="amber"
                onClick={() => onOpenInsightsDashboard("security")}
              />
              <p className="text-[0.58rem] uppercase tracking-wider text-foreground/30 font-semibold pt-3">
                Setup
              </p>
              <OverviewCard
                title="Models"
                description={
                  isAdmin
                    ? "Connections, the catalog of chat models, and complexity tiers."
                    : "Connections, chat models, and complexity tiers. View only: an Admin makes changes."
                }
                accent="indigo"
                onClick={() => onSectionChange("inference")}
              />
              <OverviewCard
                title="Detection"
                description={
                  isAdmin
                    ? "Admin-owned detection sensitivity and safe terms for this install."
                    : "Detection sensitivity and safe terms. View only: an Admin applies changes, and you can propose one."
                }
                accent="indigo"
                onClick={() => onSectionChange("workspace")}
              />
              {isAdmin && (
                <OverviewCard
                  title="Admin"
                  description="Portal name and logo, directory, roles, and monthly cost caps."
                  accent="amber"
                  onClick={() => onSectionChange("admin")}
                />
              )}
            </div>
          )}

          {section === "profile" && <ProfileSettings view="profile" />}

          {section === "account-security" && <ProfileSettings view="security" />}

          {section === "appearance" && <AppearanceSettings />}

          {section === "workspace" && (
            <div className="space-y-6">
              <div>
                <h3 className="text-section mb-1.5">Detection sensitivity</h3>
                <p className="text-xs text-foreground/35 mb-3">
                  Instance policy selects which pattern families run. Tiers are cumulative:
                  Low → Balanced (adds phone, IPv4, street addresses) → High (adds ID-shaped tokens).
                  Detection reduces exposure risk; it does not certify content as PII-free
                  or compliant.
                  {canEditSecurity
                    ? " You will be asked to confirm before the change applies."
                    : " Only an Admin can apply changes; you can propose a tier."}
                </p>
                <div className="mb-3">
                  <DetectionForwardOnlyNotice />
                </div>
                {securityNotice && (
                  <p className="text-[0.7rem] text-amber-200/80 mb-3 rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2">
                    {securityNotice}
                  </p>
                )}
                {securityPending && isAdmin && (
                  <div className="mb-3 rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-3 py-2 space-y-2">
                    <p className="text-[0.75rem] text-foreground/75">
                      Pending proposal: <strong>{securityPending.piiSensitivity}</strong>
                      {securityPending.stricterThanActive
                        ? " (stricter — applies to future detection only)"
                        : " (applies to future detection only)"}
                    </p>
                    {securityPending.note && (
                      <p className="text-[0.65rem] text-foreground/45">{securityPending.note}</p>
                    )}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => onAcceptPendingSecurity?.()}
                        className="rounded-lg bg-indigo-500/25 border border-indigo-500/40 px-3 py-1.5 text-[0.68rem] text-indigo-100 cursor-pointer"
                      >
                        Accept &amp; apply
                      </button>
                      <button
                        type="button"
                        onClick={() => onDismissPendingSecurity?.()}
                        className="rounded-lg border border-foreground/15 px-3 py-1.5 text-[0.68rem] text-foreground/55 cursor-pointer"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                )}
                <DetectionPolicyMatrix
                  currentTier={piiSensitivity}
                  selectable
                  onSelectTier={tier => {
                    if (canEditSecurity) onPiiSensitivityChange(tier);
                    else onProposeSecurity?.(tier);
                  }}
                />
                <div className="mt-3">
                  <DetectionPolicyExplainer
                    currentTier={piiSensitivity}
                    safeTermCount={safeTerms.length}
                    safeTerms={safeTerms}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => onOpenInsightsDashboard("security", "#detection-log")}
                  className="mt-3 text-[0.68rem] font-medium text-indigo-300/85 hover:text-indigo-200 cursor-pointer"
                >
                  Open detection log in Insights → Security
                </button>
              </div>

              <SafeTermsSection
                safeTerms={safeTerms}
                onAdd={onAddSafeTerm}
                onRemove={onRemoveSafeTerm}
                readOnly={!canEditSecurity}
              />
            </div>
          )}

          {(section === "inference" || section === "providers") && (
            <div className="space-y-6">
              <div className="rounded-2xl bg-foreground/[0.04] border border-foreground/[0.07] px-5 py-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm text-foreground/70">Active routing</p>
                    <p className="text-xs text-foreground/35 mt-0.5">{lastRouteLabel || "The router chooses a complexity tier."}</p>
                  </div>
                  <span className="text-[0.7rem] text-indigo-400/60 bg-indigo-400/10 rounded-lg px-2.5 py-1">{activeMode}</span>
                </div>
              </div>
              <InferenceSettings
                complexityTiers={complexityTiers}
                onProvidersChanged={onProvidersChanged}
              />
            </div>
          )}

          {section === "admin" && isAdmin && (
            <AdminConsole onOpenUserInsights={onOpenUserInsights} />
          )}
        </div>
      </div>
    </div>
  );
}
