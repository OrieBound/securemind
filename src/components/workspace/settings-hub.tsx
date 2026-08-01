"use client";

import {
  BarChart2,
  ChevronRight,
  Cloud,
  Key,
  LayoutGrid,
  Shield,
  SlidersHorizontal,
  Sparkles,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  categoriesForTier,
  NON_EXEMPTIBLE_CATEGORIES,
  categoryLabel,
  type PiiSensitivityTier,
  type SafeTerm,
  type SafeTermKind,
} from "@/lib/pii";

export type SettingsSection =
  | "overview"
  | "insights-context"
  | "insights-savings"
  | "insights-security"
  | "workspace"
  | "inference";

export const SETTINGS_SECTION_KEY = "sm_settings_section";

export const SETTINGS_SECTION_LABELS: Record<SettingsSection, string> = {
  overview:           "Overview",
  "insights-context": "Context",
  "insights-savings": "Savings",
  "insights-security":"Security",
  workspace:          "Workspace",
  inference:          "Inference & API",
};

export function isSettingsSection(v: string): v is SettingsSection {
  return v in SETTINGS_SECTION_LABELS;
}

const SENSITIVITY_TIERS: { tier: PiiSensitivityTier; label: string; blurb: string }[] = [
  { tier: "low",      label: "Low",      blurb: "Highest-harm categories only. Fewest false positives." },
  { tier: "balanced", label: "Balanced", blurb: "Adds phone numbers and IP addresses. Recommended." },
  { tier: "high",     label: "High",     blurb: "Adds street addresses." },
  { tier: "extreme",  label: "Extreme",  blurb: "Adds ID-shaped tokens. Expect false positives." },
];

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
function SafeTermsSection({
  safeTerms,
  onAdd,
  onRemove,
}: {
  safeTerms: SafeTerm[];
  onAdd: (kind: SafeTermKind, value: string, label?: string) =>
    { ok: true } | { ok: false; reason: string };
  onRemove: (id: string) => void;
}) {
  const [kind, setKind]   = useState<SafeTermKind>("cidr");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const active = SAFE_TERM_KINDS.find(k => k.kind === kind)!;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const result = onAdd(kind, value);
    if (!result.ok) { setError(result.reason); return; }
    setValue("");
    setError(null);
  }

  return (
    <div>
      <h3 className="text-sm font-semibold text-white/75 mb-1">Safe terms</h3>
      <p className="text-xs text-white/35 mb-3 leading-relaxed">
        Values you have declared are not sensitive. These are checked before detection runs,
        so a matching value is never redacted in the first place. Stored on this device only.
      </p>

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
                  : "border-white/10 bg-white/[0.03] text-white/45 hover:text-white/70",
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
            className="flex-1 min-w-0 h-9 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-xs font-mono text-white/70 placeholder:text-white/25 focus:outline-none focus:ring-1 focus:ring-indigo-500/40"
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
        <p className="text-[0.6rem] text-white/28 leading-relaxed">
          {NON_EXEMPTIBLE_CATEGORIES.map(categoryLabel).join(" and ")} can never be added —
          those are always redacted regardless of this list.
        </p>
      </form>

      <ul className="space-y-1.5">
        {safeTerms.map(t => (
          <li
            key={t.id}
            className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[0.58rem] uppercase tracking-wider text-white/30">
                  {SAFE_TERM_KINDS.find(k => k.kind === t.kind)?.label ?? t.kind}
                </span>
                <code className="text-[0.72rem] font-mono text-white/70 break-all">{t.value}</code>
              </div>
              {t.label && <p className="text-[0.6rem] text-white/25 mt-0.5">{t.label}</p>}
            </div>
            <button
              type="button"
              onClick={() => onRemove(t.id)}
              aria-label={`Remove safe term ${t.value}`}
              className="shrink-0 rounded-md border border-red-400/25 bg-red-400/10 px-2.5 py-1 text-[0.62rem] font-medium text-red-300/85 hover:bg-red-400/20 transition-colors cursor-pointer"
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

type SavingsStats = {
  totalCost: number;
  totalSaved: number;
  responseCount: number;
};

function fmtUsd(d: number): string {
  if (d === 0) return "$0.00";
  if (d < 0.0001) return "<$0.0001";
  return `$${d.toFixed(4)}`;
}

function NavItem({
  active,
  onClick,
  icon: Icon,
  label,
  indent,
  compact,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof LayoutGrid;
  label: string;
  indent?: boolean;
  compact?: boolean;
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
          ? "bg-white/[0.09] text-white/90 font-medium"
          : "text-white/45 hover:bg-white/[0.05] hover:text-white/70",
      )}
    >
      <Icon className="size-3.5 shrink-0 opacity-70" aria-hidden />
      {label}
    </button>
  );
}

/** Settings sub-nav — lives in the left sidebar when Settings mode is active. */
export function SettingsSidebarNav({
  section,
  onSectionChange,
}: {
  section: SettingsSection;
  onSectionChange: (s: SettingsSection) => void;
}) {
  return (
    <nav
      aria-label="Settings sections"
      className="shrink-0 border-t border-white/[0.06] px-2 pt-3 pb-2 space-y-0.5"
    >
      <NavItem
        active={section === "overview"}
        onClick={() => onSectionChange("overview")}
        icon={LayoutGrid}
        label="Overview"
        compact
      />

      <p className="px-2 pt-3 pb-1 text-[0.58rem] uppercase tracking-wider text-white/28 font-semibold">
        Insights
      </p>
      <NavItem
        active={section === "insights-context"}
        onClick={() => onSectionChange("insights-context")}
        icon={Sparkles}
        label="Context"
        indent
        compact
      />
      <NavItem
        active={section === "insights-savings"}
        onClick={() => onSectionChange("insights-savings")}
        icon={BarChart2}
        label="Savings"
        indent
        compact
      />
      <NavItem
        active={section === "insights-security"}
        onClick={() => onSectionChange("insights-security")}
        icon={Shield}
        label="Security"
        indent
        compact
      />

      <p className="px-2 pt-3 pb-1 text-[0.58rem] uppercase tracking-wider text-white/28 font-semibold">
        App
      </p>
      <NavItem
        active={section === "workspace"}
        onClick={() => onSectionChange("workspace")}
        icon={SlidersHorizontal}
        label="Workspace"
        compact
      />
      <NavItem
        active={section === "inference"}
        onClick={() => onSectionChange("inference")}
        icon={Key}
        label="Inference & API"
        compact
      />
    </nav>
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
        "w-full text-left rounded-xl border bg-white/[0.03] px-4 py-3.5 transition-colors cursor-pointer group",
        accentBorder,
        "hover:bg-white/[0.05]",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-white/80">{title}</p>
          <p className="text-[0.65rem] text-white/38 mt-1 leading-relaxed">{description}</p>
        </div>
        <ChevronRight className="size-4 text-white/20 group-hover:text-white/45 shrink-0 mt-0.5 transition-colors" aria-hidden />
      </div>
      {stat && (
        <p className="text-[0.62rem] font-mono text-white/35 mt-2 tabular-nums">{stat}</p>
      )}
    </button>
  );
}

/** Settings content only — sub-nav is in the left sidebar. */
export function SettingsHub({
  section,
  onSectionChange,
  onOpenSecurityDashboard,
  safeTerms,
  onAddSafeTerm,
  onRemoveSafeTerm,
  piiSensitivity,
  onPiiSensitivityChange,
  savingsStats,
  savingsBaselineLabel,
  totalRouteCalls,
  totalPiiActive,
  lastRouteLabel,
  activeMode,
  groqKeyDraft,
  onGroqKeyDraftChange,
  groqKeySaved,
  onSaveGroqKey,
  onClearGroqKey,
}: {
  section: SettingsSection;
  onSectionChange: (s: SettingsSection) => void;
  onOpenSecurityDashboard: () => void;
  safeTerms: SafeTerm[];
  onAddSafeTerm: (kind: SafeTermKind, value: string, label?: string) =>
    { ok: true } | { ok: false; reason: string };
  onRemoveSafeTerm: (id: string) => void;
  piiSensitivity: PiiSensitivityTier;
  onPiiSensitivityChange: (tier: PiiSensitivityTier) => void;
  savingsStats: SavingsStats;
  savingsBaselineLabel: string;
  totalRouteCalls: number;
  totalPiiActive: number;
  lastRouteLabel: string;
  activeMode: string;
  groqKeyDraft: string;
  onGroqKeyDraftChange: (v: string) => void;
  groqKeySaved: boolean;
  onSaveGroqKey: () => void;
  onClearGroqKey: () => void;
}) {
  return (
    <div className="flex flex-1 min-h-0 flex-col">
      {/* Mobile section picker — sidebar nav is hidden below md */}
      <div className="md:hidden shrink-0 border-b border-white/[0.06] px-4 py-2">
        <select
          value={section}
          onChange={e => onSectionChange(e.target.value as SettingsSection)}
          className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white/75"
        >
          {(Object.keys(SETTINGS_SECTION_LABELS) as SettingsSection[]).map(id => (
            <option key={id} value={id}>{SETTINGS_SECTION_LABELS[id]}</option>
          ))}
        </select>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-6">
        <div className="max-w-2xl mx-auto flex flex-col gap-5">
          <div>
            <h2 className="text-lg font-bold text-white/90 tracking-tight">
              {SETTINGS_SECTION_LABELS[section]}
            </h2>
            {section === "overview" && (
              <p className="text-sm text-white/40 mt-1">
                Central hub for insights, workspace preferences, and inference.
              </p>
            )}
          </div>

          {section === "overview" && (
            <div className="grid gap-2">
              <p className="text-[0.58rem] uppercase tracking-wider text-white/30 font-semibold">
                Insights
              </p>
              <OverviewCard
                title="Context"
                description="Complexity routing, model tiers, and usage."
                stat={totalRouteCalls > 0 ? `${totalRouteCalls} responses tracked` : "No data yet"}
                accent="indigo"
                onClick={() => onSectionChange("insights-context")}
              />
              <OverviewCard
                title="Savings"
                description="Spend, baseline comparison, and model costs."
                stat={savingsStats.responseCount > 0
                  ? `${fmtUsd(savingsStats.totalCost)} spent · ${fmtUsd(savingsStats.totalSaved)} saved`
                  : "No data yet"}
                accent="emerald"
                onClick={() => onSectionChange("insights-savings")}
              />
              <OverviewCard
                title="Security"
                description="PII detections, approvals, and governance."
                stat={totalPiiActive > 0 ? `${totalPiiActive} active detections` : "No detections"}
                accent="amber"
                onClick={() => onSectionChange("insights-security")}
              />
              <p className="text-[0.58rem] uppercase tracking-wider text-white/30 font-semibold pt-3">
                App
              </p>
              <OverviewCard
                title="Workspace"
                description="App-wide preferences and PII exceptions."
                accent="indigo"
                onClick={() => onSectionChange("workspace")}
              />
              <OverviewCard
                title="Inference & API"
                description="Bedrock (default) or bring your own Groq key."
                accent="indigo"
                onClick={() => onSectionChange("inference")}
              />
            </div>
          )}

          {section === "insights-context" && (
            <div className="space-y-4">
              <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/[0.06] px-4 py-4">
                <p className="text-xs font-semibold text-indigo-200/90">Quick glance</p>
                <p className="text-2xl font-bold tabular-nums text-white/90 mt-2">{totalRouteCalls}</p>
                <p className="text-[0.62rem] text-white/35">responses routed (current filters in overlay)</p>
                {lastRouteLabel && (
                  <p className="text-[0.62rem] text-white/40 mt-2">Last: {lastRouteLabel}</p>
                )}
              </div>
              <p className="text-[0.62rem] text-white/35 leading-relaxed">
                Use the <strong className="text-white/50 font-medium">Context</strong> tab in Cognitive Overlays for tier usage and model mapping.
                Full charts will live here in the Insights portal.
              </p>
              <button
                type="button"
                disabled
                className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] py-2.5 text-[0.72rem] font-medium text-white/30 cursor-not-allowed"
              >
                <Sparkles className="size-3.5 shrink-0" aria-hidden />
                Open context insights
                <span className="text-[0.5rem] uppercase tracking-wider text-white/20 bg-white/5 border border-white/8 px-1 py-0.5 rounded">
                  soon
                </span>
              </button>
            </div>
          )}

          {section === "insights-savings" && (
            <div className="space-y-4">
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] px-4 py-4 space-y-2">
                <div className="flex justify-between items-baseline">
                  <span className="text-xs text-white/45">Total cost</span>
                  <span className="text-xl font-bold font-mono tabular-nums text-white/90">
                    {fmtUsd(savingsStats.totalCost)}
                  </span>
                </div>
                <div className="flex justify-between items-baseline">
                  <span className="text-xs text-white/45">Saved vs {savingsBaselineLabel}</span>
                  <span className="text-lg font-bold font-mono tabular-nums text-emerald-400/90">
                    {fmtUsd(savingsStats.totalSaved)}
                  </span>
                </div>
              </div>
              <p className="text-[0.62rem] text-white/35 leading-relaxed">
                Use the <strong className="text-white/50 font-medium">Savings</strong> tab in Cognitive Overlays for live breakdowns.
              </p>
              <button
                type="button"
                disabled
                className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] py-2.5 text-[0.72rem] font-medium text-white/30 cursor-not-allowed"
              >
                <BarChart2 className="size-3.5 shrink-0" aria-hidden />
                Open savings insights
                <span className="text-[0.5rem] uppercase tracking-wider text-white/20 bg-white/5 border border-white/8 px-1 py-0.5 rounded">
                  soon
                </span>
              </button>
            </div>
          )}

          {section === "insights-security" && (
            <div className="space-y-4">
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.06] px-4 py-4">
                <p className="text-xs font-semibold text-amber-200/90">Active detections</p>
                <p className="text-2xl font-bold tabular-nums text-white/90 mt-2">{totalPiiActive}</p>
                <p className="text-[0.62rem] text-white/35 mt-1">in current time range (excludes approved & dismissed)</p>
              </div>
              <p className="text-[0.62rem] text-white/35 leading-relaxed">
                The overlay <strong className="text-white/50 font-medium">Security</strong> tab is the quick glance.
                The full dashboard supports approve, dismiss, and revoke actions.
              </p>
              <button
                type="button"
                onClick={onOpenSecurityDashboard}
                className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-indigo-500/30 bg-indigo-500/12 py-2.5 text-[0.72rem] font-semibold text-indigo-200/95 hover:bg-indigo-500/18 transition-colors cursor-pointer"
              >
                <Shield className="size-3.5 shrink-0" aria-hidden />
                Open security dashboard
                <ChevronRight className="size-3.5 shrink-0 opacity-70" aria-hidden />
              </button>
            </div>
          )}

          {section === "workspace" && (
            <div className="space-y-6">
              <div className="rounded-2xl bg-white/[0.04] border border-white/[0.07] px-5 py-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm text-white/70">Active routing</p>
                    <p className="text-xs text-white/35 mt-0.5">{lastRouteLabel || "Auto-routed via router.ts"}</p>
                  </div>
                  <span className="text-[0.7rem] text-indigo-400/60 bg-indigo-400/10 rounded-lg px-2.5 py-1">{activeMode}</span>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-white/75 mb-1">Detection sensitivity</h3>
                <p className="text-xs text-white/35 mb-3">
                  Controls which pattern families run before a message is sent.
                </p>
                <div className="space-y-1.5">
                  {SENSITIVITY_TIERS.map(t => (
                    <button
                      key={t.tier}
                      type="button"
                      onClick={() => onPiiSensitivityChange(t.tier)}
                      aria-pressed={piiSensitivity === t.tier}
                      className={cn(
                        "flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left transition-colors cursor-pointer",
                        piiSensitivity === t.tier
                          ? "border-indigo-500/40 bg-indigo-500/[0.1]"
                          : "border-white/[0.07] bg-white/[0.03] hover:border-white/15",
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "mt-1 size-2 shrink-0 rounded-full",
                          piiSensitivity === t.tier ? "bg-indigo-400" : "bg-white/20",
                        )}
                      />
                      <span className="min-w-0">
                        <span className="block text-[0.8rem] font-medium text-white/80">{t.label}</span>
                        <span className="block text-[0.65rem] text-white/35 mt-0.5">{t.blurb}</span>
                      </span>
                    </button>
                  ))}
                </div>
                <p className="text-[0.62rem] text-white/30 mt-2 leading-relaxed">
                  Currently detecting: {categoriesForTier(piiSensitivity).join(", ").toLowerCase()}.
                </p>
              </div>

              <SafeTermsSection
                safeTerms={safeTerms}
                onAdd={onAddSafeTerm}
                onRemove={onRemoveSafeTerm}
              />
            </div>
          )}

          {section === "inference" && (
            <div className="space-y-4">
              <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-4 space-y-3">
                <div className="flex items-start gap-3">
                  <Cloud className="size-5 text-white/45 shrink-0 mt-0.5" aria-hidden />
                  <div>
                    <p className="text-sm font-semibold text-white/80">Inference providers</p>
                    <p className="text-[0.62rem] text-white/40 mt-1 leading-relaxed">
                      Groq handles chat by default, with Ollama as a local fallback when Groq is
                      unavailable or no key is set. Amazon Bedrock is not wired up yet.
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-4 space-y-3">
                <div className="flex items-start gap-3">
                  <Zap className="size-5 text-amber-400/80 shrink-0 mt-0.5" aria-hidden />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-white/80">Groq — bring your own key</p>
                    <p className="text-[0.62rem] text-white/38 mt-1 leading-relaxed">
                      Optional. Uses your Groq account for the same tier routing. Key stored on this device until server-side vault (Phase C).
                    </p>
                  </div>
                </div>
                <input
                  type="password"
                  value={groqKeyDraft}
                  onChange={e => onGroqKeyDraftChange(e.target.value)}
                  placeholder={groqKeySaved ? "Key saved — enter new key to replace" : "gsk_…"}
                  autoComplete="off"
                  className="w-full h-9 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-xs font-mono text-white/70 placeholder:text-white/25 focus:outline-none focus:ring-1 focus:ring-indigo-500/40"
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={onSaveGroqKey}
                    disabled={!groqKeyDraft.trim()}
                    className="rounded-lg bg-indigo-500/20 border border-indigo-500/30 px-3 py-1.5 text-[0.68rem] font-medium text-indigo-200/90 hover:bg-indigo-500/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
                  >
                    Save key
                  </button>
                  {groqKeySaved && (
                    <button
                      type="button"
                      onClick={onClearGroqKey}
                      className="rounded-lg border border-white/10 px-3 py-1.5 text-[0.68rem] text-white/40 hover:text-red-300/80 transition-colors cursor-pointer"
                    >
                      Remove key
                    </button>
                  )}
                </div>
                {groqKeySaved && (
                  <p className="text-[0.58rem] text-emerald-400/60">Groq key saved locally on this device.</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
