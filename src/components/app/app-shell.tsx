"use client";

import {
  BarChart2,
  Bookmark,
  Brain,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  FileText,
  Loader2,
  MessageSquare,
  Pencil,
  Settings,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Mail,
  Phone,
  CreditCard,
  Hash,
  Globe,
  MapPin,
  Fingerprint,
  KeyRound,
  SlidersHorizontal,
  Sparkles,
  Square,
  Trash2,
  Upload,
  X,
  Zap,
} from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { ComposerInput, type ComposerInputHandle, type ComposerVoiceInsert } from "@/components/app/composer-input";
import {
  SettingsHub,
  SettingsSidebarNav,
  SETTINGS_SECTION_LABELS,
  SETTINGS_SECTION_KEY,
  isSettingsSection,
  type InsightsDashboard,
  type SettingsSection,
} from "@/components/app/settings-hub";
import { MemoryDashboard } from "@/components/app/memory-dashboard";
import { WorkspaceEditor } from "@/components/app/workspace-editor";
import { SecurityAnalyticsView } from "@/components/analytics/security-view";
import { UsageAnalyticsView } from "@/components/analytics/usage-view";
import { CostAnalyticsView } from "@/components/analytics/cost-view";
import {
  fetchAnalyticsJson,
  fmtPct,
  fmtUsd as fmtAnalyticsUsd,
  postSecurityEvents,
  shortModel,
} from "@/lib/analytics/client";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import EmojiPicker, { Theme, type EmojiClickData } from "emoji-picker-react";
import { cn } from "@/lib/utils";
import {
  scrubPII,
  allScannedCategories,
  categoriesForTier,
  categoryLabel,
  validateSafeTerm,
  DEFAULT_SAFE_TERMS,
  DEFAULT_SENSITIVITY,
  type MessageSegment,
  type SafeTerm,
  type SafeTermKind,
  type SafeTermMatch,
  type PiiSensitivityTier,
  type ScrubEvent,
} from "@/lib/pii";
import {
  COMPOSER_ACCEPT_ATTR,
  DOC_ACCEPT_ATTR,
  MAX_FILE_BYTES,
  MAX_FILE_MB,
  SUPPORTED_DOC_FORMATS_SHORT,
} from "@/lib/documents/constants";
import { formatAttachmentsForHistory } from "@/lib/evidence";

// ─── types ────────────────────────────────────────────────────────────────────

type RouteInfo = {
  provider: "groq" | "ollama" | "bedrock";
  model: string;
  mode: string;
  isVision?: boolean;
  wasAutoRouted?: boolean;
  costTier?: "free" | "$" | "$$" | "$$$";
  latencyMs?: number;  // time-to-first-token from send
  costUsd?: number;    // exact cost from actual token usage
  savedUsd?: number;   // savings vs 70B baseline
};

type CitationRef = {
  index: number;
  fragmentId: string;
  category: string;
  documentId: string | null;
  documentName: string | null;
  preview: string;
  similarity: number;
};

type CitationAuditRef = {
  status:
    | "not_applicable"
    | "n/a"
    | "declined"
    | "grounded"
    | "partial"
    | "uncited"
    | "invalid"
    | "insufficient_evidence";
  citedIndices: number[];
  invalidIndices: number[];
  unusedIndices: number[];
  claimCount: number;
  citedClaimCount: number;
};

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
  segments?: MessageSegment[];
  scrubEvents?: ScrubEvent[];
  bookmarked?: boolean;
  error?: string;
  images?: string[];   // base64 data URLs for inline image display
  routeInfo?: RouteInfo;
  /** Retrieved sources for this turn — used citations only. */
  citations?: CitationRef[];
  /** Set when the server found no usable evidence for an evidence-seeking question. */
  evidenceStatus?: "insufficient";
  /** Post-stream citation coverage check. */
  citationAudit?: CitationAuditRef;
  /** When false, hide grounding badge (social / general turns). */
  showGroundingBadge?: boolean;
};

type BookmarkEntry = {
  messageId: string;
  label: string;
  preview: string;
  heavy: boolean;
  read?: boolean;
  createdAt?: string;
  role?: "user" | "assistant";
  emojis?: string[];
};

type WorkspaceFactRecord = {
  id: string;
  key: string;
  value: string;
  confidence: number;
  source: string | null;
  updatedAt: string;
};

type SessionSummaryRecord = {
  id: string;
  summary: string;
  turnsCovered: number;
  updatedAt: string;
  session: { id: string; createdAt: string };
};

type DocRecord = {
  id:             string;
  workspaceId:        string | null;
  name:           string;
  mimeType:       string;
  sizeBytes:      number;
  description:    string | null;
  status:         "processing" | "ready" | "failed";
  chunkCount:     number;
  contentPreview: string;
  /** Scrubbed body — present on fresh upload responses for same-turn chat use. */
  content?:       string;
  createdAt:      string;
  redactionCount?: number;
  scrubEvents?:   ScrubEvent[];
  hadRedactions?: boolean;
};

type DocFragment = { id: string; content: string; createdAt: string };

type DocDetail = DocRecord & {
  content:   string;
  fragments: DocFragment[];
};

/**
 * A single detection, recorded for the security log.
 *
 * Deliberately carries no value and no restore path. `context` is the already
 * sanitized surrounding text, so this record is safe to persist.
 */
type RedactionRecord = {
  id:        string;
  category:  string;
  context:   string;
};

type SessionScrubEntry = {
  turn:       number;
  events:     ScrubEvent[];
  redactions: RedactionRecord[];
  at:         string;
  workspaceId?:   string;
  source?:    "chat" | "document";
  documentId?:   string;
  documentName?: string;
  /** Safe terms that suppressed a detection. Term ids and counts only. */
  safeTermMatches?: SafeTermMatch[];
};

/**
 * A message held at the pre-send review step.
 *
 * `raw` lives here only until the user confirms or cancels. It is never
 * persisted, and only `scrub.sanitized` is ever transmitted.
 */
type PendingSend = {
  raw:           string;
  sanitized:     string;
  segments:      MessageSegment[];
  scrubEvents:   ScrubEvent[];
  safeTermMatches: SafeTermMatch[];
  imageDataUrls: string[];
  attachmentDocumentIds: string[];
  attachmentHistoryBlock: string;
};

type DeliverPayload = {
  raw: string;
  sanitized: string;
  segments: MessageSegment[];
  scrubEvents: ScrubEvent[];
  safeTermMatches: SafeTermMatch[];
  imageDataUrls: string[];
  hadRedactions: boolean;
  attachmentDocumentIds?: string[];
  attachmentHistoryBlock?: string;
};

type Workspace = {
  id:            string;
  name:          string;
  emoji:         string;
  color:         string;
  context:       string | null;
  description:   string | null;
  modelOverride?: string | null;
  isDefault:     boolean;
  sessions?: { messages: { content: string; role: string }[] }[];
};

// ─── model selection ──────────────────────────────────────────────────────────

const SELECTABLE_MODELS = [
  { id: "llama-3.3-70b-versatile",                    label: "Llama 3.3 70B",         speed: "280 T/s",  tier: "$$"  as const },
  { id: "qwen/qwen3-32b",                             label: "Qwen3 32B",             speed: "400 T/s",  tier: "$$"  as const },
  { id: "openai/gpt-oss-120b",                        label: "GPT OSS 120B",          speed: "600 T/s",  tier: "$$"  as const },
  { id: "meta-llama/llama-4-scout-17b-16e-instruct",  label: "Llama 4 Scout 17B",    speed: "750 T/s",  tier: "$"   as const },
  { id: "openai/gpt-oss-20b",                         label: "GPT OSS 20B",           speed: "1000 T/s", tier: "$"   as const },
  { id: "llama-3.1-8b-instant",                       label: "Llama 3.1 8B",         speed: "560 T/s",  tier: "$"   as const },
];

// Default model assigned to each complexity tier (mirrors router.ts COMPLEXITY_TIERS)
const DEFAULT_MODE_MODELS: Record<string, string> = {
  Max:      "llama-3.3-70b-versatile",
  High:     "llama-3.3-70b-versatile",
  Plus:     "qwen/qwen3-32b",
  Standard: "openai/gpt-oss-120b",
  Light:    "meta-llama/llama-4-scout-17b-16e-instruct",
  Fast:     "openai/gpt-oss-20b",
  Micro:    "llama-3.1-8b-instant",
};

function shortModelName(id: string): string {
  const map: Record<string, string> = {
    "llama-3.3-70b-versatile":                       "70b-versatile",
    "qwen/qwen3-32b":                                "qwen3-32b",
    "openai/gpt-oss-120b":                           "gpt-oss-120b",
    "meta-llama/llama-4-scout-17b-16e-instruct":     "4-scout-17b",
    "openai/gpt-oss-20b":                            "gpt-oss-20b",
    "llama-3.1-8b-instant":                          "8b-instant",
  };
  return map[id] ?? (id.split("/").pop() ?? id);
}

function displayModelLabel(id: string): string {
  return SELECTABLE_MODELS.find(m => m.id === id)?.label ?? shortModelName(id);
}

const PII_SCAN_ICONS: Record<string, typeof Mail> = {
  "Email addresses": Mail,
  "Phone numbers": Phone,
  "Credit / debit card numbers": CreditCard,
  "Social Security numbers": Hash,
  "IPv4 addresses": Globe,
  "Street addresses": MapPin,
  "Passport / national ID patterns": Fingerprint,
  "API keys & secrets": KeyRound,
};

type RouteHit = {
  tier: string;
  model: string;
  at: string;
  workspaceId?: string;
  promptTokens?: number;
  completionTokens?: number;
  costUsd?: number;
  savedUsd?: number;
};
type StatsRange = "today" | "monthly" | "all";

const ROUTE_HISTORY_KEY = "sm_route_history";
const SAVINGS_BASELINE_KEY = "sm_savings_baseline";
const GROQ_BYOK_KEY = "sm_groq_byok";
const SETTINGS_TRANSITION_MS = 300;
const viewTransition = "transition-all duration-300 ease-in-out";
const PII_ARCHIVE_KEY     = "sm_pii_archive";
const PII_DISMISSED_KEY   = "sm_pii_dismissed";
const PII_SENSITIVITY_KEY = "sm_pii_sensitivity";
const SAFE_TERMS_KEY      = "sm_safe_terms";

/** Keys written by the removed approve-to-expose flow. Purged on first load. */
const LEGACY_PII_APPROVALS_KEY = "sm_pii_approvals";
const PII_PURGE_FLAG_KEY       = "sm_pii_purged_v2";

/**
 * One-time cleanup for installs that ran the old approve-to-expose flow.
 *
 * That flow stored raw detected values under sm_pii_approvals, and wrote
 * `restored` values into archived redaction records. Neither should ever have
 * been on disk. This removes both, and is a no-op on fresh installs.
 */
function purgeLegacyPiiValues() {
  try {
    if (localStorage.getItem(PII_PURGE_FLAG_KEY)) return;

    localStorage.removeItem(LEGACY_PII_APPROVALS_KEY);

    const archive = localStorage.getItem(PII_ARCHIVE_KEY);
    if (archive) {
      const parsed = JSON.parse(archive) as SessionScrubEntry[];
      const cleaned = parsed.map(entry => ({
        ...entry,
        redactions: entry.redactions.map(({ id, category, context }) => ({ id, category, context })),
      }));
      localStorage.setItem(PII_ARCHIVE_KEY, JSON.stringify(cleaned));
    }

    localStorage.setItem(PII_PURGE_FLAG_KEY, new Date().toISOString());
  } catch {
    /* storage unavailable — nothing to purge */
  }
}

function persistPiiArchive(entries: SessionScrubEntry[]) {
  try { localStorage.setItem(PII_ARCHIVE_KEY, JSON.stringify(entries)); } catch { /* quota */ }
}

function persistSafeTerms(terms: SafeTerm[]) {
  try { localStorage.setItem(SAFE_TERMS_KEY, JSON.stringify(terms)); } catch { /* quota */ }
}

function persistPiiDismissed(ids: Set<string>) {
  try { localStorage.setItem(PII_DISMISSED_KEY, JSON.stringify([...ids])); } catch { /* quota */ }
}

function workspaceDisplay(workspaces: Workspace[], workspaceId?: string): { name: string; emoji?: string } {
  if (!workspaceId) return { name: "Unknown workspace" };
  const a = workspaces.find(x => x.id === workspaceId);
  return a ? { name: a.name, emoji: a.emoji } : { name: "Removed workspace" };
}

/** Keep only companion-tagged hits so All = sum of per-companion counts. */
function taggedRouteHits(hits: RouteHit[], knownWorkspaceIds?: Set<string>): RouteHit[] {
  return hits.filter(h => {
    if (!h.workspaceId) return false;
    if (knownWorkspaceIds && !knownWorkspaceIds.has(h.workspaceId)) return false;
    return true;
  });
}

function persistRouteHistory(hits: RouteHit[]) {
  try { localStorage.setItem(ROUTE_HISTORY_KEY, JSON.stringify(hits)); } catch { /* quota */ }
}

function navTitle(nav: NavId): string {
  if (nav === "settings") return "App settings";
  if (nav === "workspace-settings") return "Workspace";
  if (nav === "security-dashboard") return "Security";
  if (nav === "thread") return "Chat";
  return SUB_NAV_ITEMS.find(n => n.id === nav)?.label ?? nav;
}

const COMPANION_NAV_IDS = ["thread", "bookmarks", "documents", "memory", "workspace-settings"] as const;
type WorkspaceNavId = (typeof COMPANION_NAV_IDS)[number];

function isWorkspaceNav(nav: NavId): nav is WorkspaceNavId {
  return (COMPANION_NAV_IDS as readonly string[]).includes(nav);
}

function WorkspaceBreadcrumb({
  agent,
  sectionLabel,
  pickerId,
  open,
  onToggle,
  workspaces,
  onSelectAgent,
}: {
  agent: Workspace | null | undefined;
  sectionLabel: string;
  pickerId?: string;
  open?: boolean;
  onToggle?: () => void;
  workspaces?: Workspace[];
  onSelectAgent?: (id: string) => void;
}) {
  const canPick = workspaces && onSelectAgent && onToggle;

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 min-w-0 text-sm">
      {canPick && agent ? (
        <div className="relative" data-companion-picker-root={pickerId}>
          <button
            type="button"
            onClick={onToggle}
            className={cn(
              "flex items-center gap-1 rounded-lg px-1.5 py-0.5 -ml-1.5 transition-colors cursor-pointer",
              "font-semibold text-white/90 hover:bg-white/5",
              open && "bg-white/8",
            )}
          >
            <span className="truncate">{agent.name}</span>
            <ChevronDown className={cn("size-3 text-white/35 shrink-0 transition-transform", open && "rotate-180")} aria-hidden />
          </button>
          {open && (
            <div className="absolute top-full left-0 mt-1 z-30 w-52 rounded-xl bg-[#0e0e14] border border-white/10 shadow-2xl shadow-black/60 py-1 overflow-hidden">
              <p className="px-3 py-1.5 text-[0.6rem] uppercase tracking-widest text-white/25">Switch workspace</p>
              {workspaces.map(a => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => onSelectAgent(a.id)}
                  className={cn(
                    "flex w-full items-center gap-2.5 px-3 py-2 text-sm transition-colors text-left cursor-pointer",
                    a.id === agent.id
                      ? "text-white/85 bg-white/6"
                      : "text-white/45 hover:bg-white/5 hover:text-white/70",
                  )}
                >
                  <span>{a.emoji}</span>
                  <span className="flex-1 truncate">{a.name}</span>
                  {a.id === agent.id && <Check className="size-3.5 text-indigo-400 shrink-0" aria-hidden />}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : agent ? (
        <span className="font-semibold text-white/90 truncate">{agent.name}</span>
      ) : null}
      {agent && (
        <>
          <ChevronRight className="size-3.5 text-white/25 shrink-0" aria-hidden />
          <span className="text-white/45 truncate font-medium">{sectionLabel}</span>
        </>
      )}
      {!agent && <span className="font-semibold text-white/70">{sectionLabel}</span>}
    </nav>
  );
}

function groupPiiByDate(
  entries: SessionScrubEntry[],
  dismissed: Set<string> = new Set(),
): { dayKey: string; label: string; items: { entry: SessionScrubEntry; rec: RedactionRecord }[] }[] {
  const map = new Map<string, { label: string; items: { entry: SessionScrubEntry; rec: RedactionRecord }[] }>();
  for (const entry of entries) {
    const dayKey = new Date(entry.at).toDateString();
    const label = formatDateDivider(entry.at);
    if (!map.has(dayKey)) map.set(dayKey, { label, items: [] });
    for (const rec of entry.redactions) {
      if (dismissed.has(rec.id)) continue;
      map.get(dayKey)!.items.push({ entry, rec });
    }
  }
  return [...map.entries()]
    .sort((a, b) => new Date(b[0]).getTime() - new Date(a[0]).getTime())
    .map(([dayKey, v]) => ({ dayKey, ...v, items: v.items.sort(
      (a, b) => new Date(b.entry.at).getTime() - new Date(a.entry.at).getTime(),
    ) }));
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfMonth(): Date {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

function filterByRange<T extends { at: string }>(
  items: T[],
  range: StatsRange,
): T[] {
  if (range === "all") return items;
  if (range === "today") {
    const t0 = startOfToday().getTime();
    return items.filter(i => new Date(i.at).getTime() >= t0);
  }
  const t0 = startOfMonth().getTime();
  return items.filter(i => new Date(i.at).getTime() >= t0);
}

function StatsRangePicker({
  value,
  onChange,
}: {
  value: StatsRange;
  onChange: (v: StatsRange) => void;
}) {
  const options: { id: StatsRange; label: string }[] = [
    { id: "today",   label: "Today" },
    { id: "monthly", label: "Monthly" },
    { id: "all",     label: "All time" },
  ];
  return (
    <div className="flex gap-1.5 p-1 bg-white/5 rounded-lg border border-white/6">
      {options.map(opt => (
        <button
          key={opt.id}
          type="button"
          onClick={() => onChange(opt.id)}
          className={cn(
            "flex-1 min-w-0 whitespace-nowrap text-[0.68rem] font-medium rounded-md px-2.5 py-1.5 transition-all",
            value === opt.id
              ? "bg-white/10 text-white/80 shadow-sm"
              : "text-white/30 hover:text-white/55",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function SavingsBaselinePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (modelId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = SELECTABLE_MODELS.find(m => m.id === value);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={rootRef}>
      <div className="flex items-center gap-2">
        <span className="text-[0.62rem] font-medium text-white/35 shrink-0">Baseline model</span>
        <div className="relative flex-1 min-w-0">
          <button
            type="button"
            onClick={() => setOpen(p => !p)}
            aria-haspopup="listbox"
            aria-expanded={open}
            className={cn(
              "flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-colors cursor-pointer",
              open ? "border-indigo-400/35 bg-indigo-500/10" : "border-white/10 bg-white/[0.04] hover:bg-white/[0.06]",
            )}
          >
            <span className="text-[0.68rem] text-white/70 truncate">
              {selected?.label ?? displayModelLabel(value)}
            </span>
            <ChevronDown className={cn("size-3 text-white/35 shrink-0 transition-transform", open && "rotate-180")} aria-hidden />
          </button>
          {open && (
            <ul
              role="listbox"
              className="absolute z-30 mt-1 w-full max-h-48 overflow-y-auto rounded-xl border border-white/10 bg-[#0e0e14] py-1 shadow-2xl shadow-black/60"
            >
              {SELECTABLE_MODELS.map(m => (
                <li key={m.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={m.id === value}
                    onClick={() => { onChange(m.id); setOpen(false); }}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[0.68rem] transition-colors cursor-pointer",
                      m.id === value ? "bg-indigo-500/15 text-indigo-200" : "text-white/50 hover:bg-white/5 hover:text-white/75",
                    )}
                  >
                    <span className="truncate">{m.label}</span>
                    {m.id === value && <Check className="size-3 text-indigo-400 shrink-0" aria-hidden />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function WorkspaceStatsFilter({
  workspaces,
  value,
  onChange,
}: {
  workspaces: Workspace[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const selectedAgent = workspaces.find(a => a.id === value);
  const selectedLabel = value === "all"
    ? "All workspaces"
    : selectedAgent
      ? `${selectedAgent.emoji} ${selectedAgent.name}`
      : "All workspaces";

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const options: { id: string; label: string; emoji?: string }[] = [
    { id: "all", label: "All workspaces" },
    ...workspaces.map(a => ({ id: a.id, label: a.name, emoji: a.emoji })),
  ];

  return (
    <div ref={rootRef} className="mb-2">
      <div className="flex items-center gap-2">
        <span className="text-[0.62rem] font-medium text-white/35 shrink-0">Workspace</span>
        <div className="relative flex-1 min-w-0">
          <button
            type="button"
            onClick={() => setOpen(p => !p)}
            aria-haspopup="listbox"
            aria-expanded={open}
            className={cn(
              "flex w-full items-center justify-between gap-2 h-7 rounded-md px-2",
              "bg-white/5 border border-white/8 text-[0.68rem] text-white/70",
              "hover:bg-white/[0.07] hover:border-white/12 transition-colors cursor-pointer",
              open && "border-white/15 bg-white/[0.07]",
            )}
          >
            <span className="truncate text-left">{selectedLabel}</span>
            <ChevronDown className={cn("size-3 shrink-0 text-white/35 transition-transform", open && "rotate-180")} aria-hidden />
          </button>
          {open && (
            <div
              role="listbox"
              className="absolute top-full left-0 right-0 mt-1 z-30 rounded-xl bg-[#0e0e14] border border-white/10 shadow-2xl shadow-black/60 py-1 overflow-hidden max-h-48 overflow-y-auto"
            >
              {options.map(opt => (
                <button
                  key={opt.id}
                  type="button"
                  role="option"
                  aria-selected={value === opt.id}
                  onClick={() => { onChange(opt.id); setOpen(false); }}
                  className={cn(
                    "flex w-full items-center gap-2 px-2.5 py-1.5 text-[0.68rem] text-left transition-colors cursor-pointer",
                    value === opt.id
                      ? "text-white/85 bg-white/6"
                      : "text-white/50 hover:bg-white/5 hover:text-white/75",
                  )}
                >
                  {opt.emoji && <span className="shrink-0">{opt.emoji}</span>}
                  <span className="flex-1 truncate">{opt.label}</span>
                  {value === opt.id && <Check className="size-3 text-indigo-400 shrink-0" aria-hidden />}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── pricing ──────────────────────────────────────────────────────────────────
// Groq published pricing (USD per million tokens, input/output).
// The baseline is 70B versatile — savings are measured against it.

const GROQ_MODEL_PRICING: Record<string, { inputPerM: number; outputPerM: number }> = {
  "llama-3.3-70b-versatile":                   { inputPerM: 0.59,  outputPerM: 0.79 },
  "qwen/qwen3-32b":                            { inputPerM: 0.29,  outputPerM: 0.59 },
  "openai/gpt-oss-120b":                       { inputPerM: 0.15,  outputPerM: 0.60 },
  "meta-llama/llama-4-scout-17b-16e-instruct": { inputPerM: 0.11,  outputPerM: 0.34 },
  "openai/gpt-oss-20b":                        { inputPerM: 0.075, outputPerM: 0.30 },
  "llama-3.1-8b-instant":                      { inputPerM: 0.05,  outputPerM: 0.08 },
};
const DEFAULT_SAVINGS_BASELINE = "llama-3.3-70b-versatile";
/** Fallback token split when exact usage wasn't captured (est. ~700 tokens/turn). */
const EST_PROMPT_TOKENS = 500;
const EST_COMPLETION_TOKENS = 200;

function calcTurnCost(
  model: string,
  promptTokens: number,
  completionTokens: number,
  baselineModel = DEFAULT_SAVINGS_BASELINE,
): { costUsd: number; savedUsd: number } {
  const p = GROQ_MODEL_PRICING[model];
  const b = GROQ_MODEL_PRICING[baselineModel] ?? GROQ_MODEL_PRICING[DEFAULT_SAVINGS_BASELINE]!;
  if (!p) return { costUsd: 0, savedUsd: 0 };
  const cost     = (promptTokens * p.inputPerM     + completionTokens * p.outputPerM)     / 1_000_000;
  const baseline = (promptTokens * b.inputPerM + completionTokens * b.outputPerM) / 1_000_000;
  return { costUsd: cost, savedUsd: Math.max(0, baseline - cost) };
}

function turnCostForHit(hit: RouteHit, baselineModel: string): { costUsd: number; savedUsd: number } {
  if (hit.promptTokens != null && hit.completionTokens != null) {
    return calcTurnCost(hit.model, hit.promptTokens, hit.completionTokens, baselineModel);
  }
  return calcTurnCost(hit.model, EST_PROMPT_TOKENS, EST_COMPLETION_TOKENS, baselineModel);
}

function fmtUsd(d: number): string {
  if (d === 0) return "$0.00";
  if (d < 0.0001) return "<$0.0001";
  return `$${d.toFixed(4)}`;
}

// ─── constants ────────────────────────────────────────────────────────────────

const DEFAULT_WORKSPACE_NAME = "Aegis";

// Complexity tiers — ordered most capable → cheapest (mirrors router.ts COMPLEXITY_TIERS)
const MODES = [
  "Max",
  "High",
  "Plus",
  "Standard",
  "Light",
  "Fast",
  "Micro",
] as const;
type Mode = (typeof MODES)[number];

const SUB_NAV_ITEMS = [
  {
    id: "thread" as const,
    label: "Chat",
    icon: MessageSquare,
    iconWrap: "bg-indigo-500/20 border-indigo-500/25",
    iconColor: "text-indigo-300",
  },
  {
    id: "documents" as const,
    label: "Knowledge",
    icon: FileText,
    iconWrap: "bg-emerald-500/20 border-emerald-500/25",
    iconColor: "text-emerald-300",
  },
  {
    id: "memory" as const,
    label: "Memory",
    icon: Brain,
    iconWrap: "bg-violet-500/20 border-violet-500/25",
    iconColor: "text-violet-300",
  },
  {
    id: "bookmarks" as const,
    label: "Saved",
    icon: Bookmark,
    iconWrap: "bg-amber-500/20 border-amber-500/25",
    iconColor: "text-amber-300",
  },
] as const;
type NavId = (typeof SUB_NAV_ITEMS)[number]["id"] | "workspace-settings" | "settings" | "security-dashboard";

// ─── helpers ──────────────────────────────────────────────────────────────────

const ACTIVE_WORKSPACE_KEY = "sm_active_workspace";
/** Stash workspace tab when leaving /analytics/* so remount can restore Chat/Knowledge/etc. */
const PENDING_WORK_NAV_KEY = "sm_pending_work_nav";
const messagesCacheKey = (workspaceId: string) => `sm_msgs_${workspaceId}`;

function readCachedMessages(workspaceId: string): ChatMessage[] | null {
  try {
    const raw = sessionStorage.getItem(messagesCacheKey(workspaceId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ChatMessage[];
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeCachedMessages(workspaceId: string, msgs: ChatMessage[]) {
  try {
    sessionStorage.setItem(messagesCacheKey(workspaceId), JSON.stringify(msgs));
  } catch { /* quota / private browsing */ }
}

async function persistMessage(
  sessionId: string,
  role: "user" | "assistant",
  content: string,
): Promise<void> {
  const trimmed = content.trim();
  if (!trimmed) return;
  const res = await fetch("/api/messages", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ sessionId, role, content: trimmed }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(err || `Save failed (${res.status})`);
  }
}

function pct(v: number) { return `${Math.round(v * 100)}%`; }

function nameInitials(name: string) {
  return name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function timeSince(dateStr: string): string {
  const secs = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (secs < 60)   return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

function formatMsgTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function formatBookmarkDateTime(iso: string): string {
  const divider = formatDateDivider(iso);
  const time = formatMsgTime(iso);
  if (divider === "Today") return `Today · ${time}`;
  if (divider === "Yesterday") return `Yesterday · ${time}`;
  return `${divider} · ${time}`;
}

function extractEmojis(text: string, limit = 6): string[] {
  const matches = text.match(/\p{Extended_Pictographic}/gu) ?? [];
  return [...new Set(matches)].slice(0, limit);
}

function groupBookmarksByDate(
  items: BookmarkEntry[],
): { dayKey: string; label: string; items: BookmarkEntry[] }[] {
  const map = new Map<string, { label: string; items: BookmarkEntry[] }>();
  for (const bm of items) {
    const at = bm.createdAt ?? new Date(0).toISOString();
    const dayKey = new Date(at).toDateString();
    const label = bm.createdAt ? formatDateDivider(at) : "Unknown date";
    if (!map.has(dayKey)) map.set(dayKey, { label, items: [] });
    map.get(dayKey)!.items.push(bm);
  }
  return [...map.entries()]
    .sort((a, b) => new Date(b[0]).getTime() - new Date(a[0]).getTime())
    .map(([dayKey, v]) => ({
      dayKey,
      label: v.label,
      items: v.items.sort(
        (a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime(),
      ),
    }));
}

function formatDateDivider(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function docTypeInfo(mimeType: string): { label: string; cls: string } {
  if (mimeType === "application/pdf")   return { label: "PDF",  cls: "text-red-400 bg-red-500/10 border-red-500/20" };
  if (mimeType === "text/markdown")     return { label: "MD",   cls: "text-sky-400 bg-sky-500/10 border-sky-500/20" };
  if (mimeType === "application/json")  return { label: "JSON", cls: "text-amber-400 bg-amber-500/10 border-amber-500/20" };
  if (mimeType === "text/csv")          return { label: "CSV",  cls: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" };
  if (mimeType.startsWith("text/x-"))  return { label: "CODE", cls: "text-violet-400 bg-violet-500/10 border-violet-500/20" };
  return { label: "TXT", cls: "text-white/40 bg-white/5 border-white/10" };
}

// ─── Redacted inline block ────────────────────────────────────────────────────

function RedactedBlock({ category }: { category: string }) {
  return (
    <span
      aria-label={`${category} removed for privacy`}
      className="inline-flex items-center gap-1 mx-0.5 rounded-md px-2 py-0.5 align-middle
                 bg-white/8 border border-white/10
                 text-[0.68rem] font-mono text-white/40 select-none cursor-default"
    >
      <Shield className="size-2.5 shrink-0" aria-hidden />
      {categoryLabel(category)}
    </span>
  );
}

// ─── Avatar ───────────────────────────────────────────────────────────────────

function WorkspaceAvatar({
  name,
  emoji,
  color,
  size = "sm",
}: {
  name: string;
  emoji?: string;
  color?: string;
  size?: "sm" | "md";
}) {
  const cls = size === "md" ? "size-9 text-base" : "size-7 text-sm";
  if (emoji && color) {
    return (
      <div
        className={cn("shrink-0 rounded-xl flex items-center justify-center select-none", cls)}
        style={{ backgroundColor: color + "33", border: `1px solid ${color}55` }}
        aria-hidden
      >
        {emoji}
      </div>
    );
  }
  // Fallback: letter initial
  return (
    <div
      className={cn(
        "shrink-0 rounded-xl flex items-center justify-center font-semibold select-none text-xs",
        "bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-lg shadow-indigo-900/30",
        cls,
      )}
    >
      {nameInitials(name)}
    </div>
  );
}

/** Hide history-only attachment payloads from the visible user bubble. */
function stripAttachedDocumentBlock(content: string): string {
  const idx = content.search(/\n\n\[Attached document:/);
  if (idx === -1) return content;
  const visible = content.slice(0, idx).trim();
  return visible || "Attached file for review.";
}

// ─── MessageBubble ────────────────────────────────────────────────────────────

const MessageBubble = memo(function MessageBubble({
  message,
  workspaceName,
  workspaceEmoji,
  workspaceColor,
  onBookmark,
  highlighted = false,
  showTimestamp = true,
}: {
  showTimestamp?: boolean;
  message: ChatMessage;
  /** Workspace name doubles as the assistant speaker identity in chat. */
  workspaceName: string;
  workspaceEmoji?: string;
  workspaceColor?: string;
  onBookmark: (id: string) => void;
  highlighted?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const isUser = message.role === "user";
  const displayContent = isUser ? stripAttachedDocumentBlock(message.content) : message.content;

  const body = isUser && message.segments ? (
    <p className="whitespace-pre-wrap break-words leading-relaxed">
      {message.segments.map((seg, i) =>
        seg.redacted
          ? <RedactedBlock key={i} category={seg.category} />
          : <span key={i}>{seg.text}</span>,
      )}
    </p>
  ) : (
    <div className="text-sm leading-relaxed">
      {message.error
        ? (
          <span className="flex items-start gap-2 text-red-400/80">
            <span className="shrink-0 mt-0.5">⚠</span>
            <span>{
              message.error.match(/^4\d\d|^5\d\d/)
                ? "Something went wrong reaching the AI. Check your GROQ_API_KEY or make sure Ollama is running."
                : message.error
            }</span>
          </span>
        )
        : displayContent
          ? (
            <div className="chat-prose">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {message.content}
              </ReactMarkdown>
            </div>
          )
          : message.role === "assistant"
            ? (
              <span className="inline-flex gap-1 items-center">
                <span className="animate-bounce delay-0   size-1.5 rounded-full bg-white/30 inline-block" />
                <span className="animate-bounce delay-150 size-1.5 rounded-full bg-white/30 inline-block" />
                <span className="animate-bounce delay-300 size-1.5 rounded-full bg-white/30 inline-block" />
              </span>
            )
            : null}
    </div>
  );

  if (isUser) {
    return (
      <div
        data-message-id={message.id}
        className={cn(
          "flex justify-end group rounded-2xl transition-all duration-300",
          highlighted && "ring-2 ring-indigo-400/50 ring-offset-4 ring-offset-transparent",
        )}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <div className="relative max-w-[75%]">
          {/* Bookmark button */}
          <button
            onClick={() => onBookmark(message.id)}
            aria-label={message.bookmarked ? "Remove from saved" : "Save conclusion"}
            className={cn(
              "absolute -top-2 -left-7 rounded-full p-1 transition-all duration-150",
              "bg-white/5 border border-white/8 hover:bg-white/10",
              hovered || message.bookmarked ? "opacity-100" : "opacity-0 pointer-events-none",
              message.bookmarked && "text-primary",
            )}
          >
            <Bookmark className={cn("size-3", message.bookmarked && "fill-current")} aria-hidden />
          </button>

          <div className="rounded-2xl rounded-tr-sm bg-white/8 border border-white/8 px-4 py-3 text-sm text-foreground">
            {/* Attached images */}
            {message.images && message.images.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {message.images.map((src, i) => (
                  <img
                    key={i}
                    src={src}
                    alt="attachment"
                    className="max-h-48 max-w-full rounded-xl object-cover border border-white/10"
                  />
                ))}
              </div>
            )}
            {body}
            {message.scrubEvents && message.scrubEvents.length > 0 && (
              <p className="mt-2 flex items-center gap-1.5 border-t border-white/8 pt-2 text-[0.68rem] text-white/35">
                <ShieldCheck className="size-3 shrink-0" aria-hidden />
                {message.scrubEvents.map(e => `${e.count} ${e.category}`).join(", ")} removed
              </p>
            )}
          </div>
          {showTimestamp && message.createdAt && (
            <p suppressHydrationWarning className="mt-1 text-right text-[0.6rem] text-white/25 tabular-nums select-none">
              {formatMsgTime(message.createdAt)}
            </p>
          )}
        </div>
      </div>
    );
  }

  // Assistant message — avatar + text, no bubble
  return (
    <div
      data-message-id={message.id}
      className={cn(
        "flex items-start gap-3 group rounded-2xl px-2 -mx-2 transition-all duration-300",
        highlighted && "ring-2 ring-indigo-400/50 ring-offset-4 ring-offset-transparent",
      )}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <WorkspaceAvatar name={workspaceName} emoji={workspaceEmoji} color={workspaceColor} />

      <div className="flex-1 min-w-0 relative pt-0.5">
        {/* Bookmark */}
        <button
          onClick={() => onBookmark(message.id)}
          aria-label={message.bookmarked ? "Remove from saved" : "Save conclusion"}
          className={cn(
            "absolute -top-3 right-0 rounded-full p-1 transition-all duration-150",
            "bg-white/5 border border-white/8 hover:bg-white/10",
            hovered || message.bookmarked ? "opacity-100" : "opacity-0 pointer-events-none",
            message.bookmarked && "text-primary",
          )}
        >
          <Bookmark className={cn("size-3", message.bookmarked && "fill-current")} aria-hidden />
        </button>

        <p className="mb-1 text-[0.68rem] font-medium text-white/35">{workspaceName}</p>
        <div className="text-sm text-foreground/90">{body}</div>

        {/* Route badge — shows which mode + model handled this turn */}
        {message.routeInfo && !message.error && (
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            {/* Provider pill */}
            <span className={cn(
              "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[0.6rem] font-mono font-semibold uppercase tracking-wide",
              message.routeInfo.provider === "groq"
                ? "text-indigo-400/80 bg-indigo-400/10 border border-indigo-400/15"
                : "text-emerald-400/70 bg-emerald-400/8 border border-emerald-400/15",
            )}>
              <Zap className="size-2.5 shrink-0" aria-hidden />
              {message.routeInfo.provider === "ollama" ? "local" : message.routeInfo.provider}
            </span>
            {/* Mode — with "auto" indicator when classifier picked it */}
            <span className="text-[0.65rem] text-white/40 font-medium inline-flex items-center gap-1">
              {message.routeInfo.mode}
              {message.routeInfo.isVision && " · vision"}
              {message.routeInfo.wasAutoRouted && (
                <span className="text-[0.55rem] text-indigo-400/50 font-mono uppercase tracking-wide">auto</span>
              )}
            </span>
            <span className="text-white/15 text-[0.6rem]">·</span>
            <code className="text-[0.65rem] font-mono text-white/30">
              {message.routeInfo.model}
            </code>
            {message.routeInfo.latencyMs !== undefined && (
              <span className="text-[0.6rem] text-white/20 tabular-nums">
                · {message.routeInfo.latencyMs < 1000
                  ? `${message.routeInfo.latencyMs}ms`
                  : `${(message.routeInfo.latencyMs / 1000).toFixed(1)}s`}
              </span>
            )}
          </div>
        )}
        {(message.citations?.length || message.evidenceStatus === "insufficient" || (message.showGroundingBadge !== false && message.citationAudit)) && !message.error && (
          <div className="mt-2.5 space-y-1.5">
            {message.evidenceStatus === "insufficient" && !message.citations?.length && (
              <p className="flex items-center gap-1.5 text-[0.65rem] text-amber-200/50">
                <ShieldAlert className="size-3 shrink-0" aria-hidden />
                No relevant workspace Knowledge for this question
              </p>
            )}
            {message.showGroundingBadge !== false && message.citationAudit && message.citationAudit.status !== "n/a" && message.citationAudit.status !== "not_applicable" && (
              <p
                className={cn(
                  "flex items-center gap-1.5 text-[0.65rem]",
                  message.citationAudit.status === "grounded" || message.citationAudit.status === "declined"
                    ? "text-emerald-300/55"
                    : message.citationAudit.status === "partial"
                      ? "text-amber-200/55"
                      : "text-red-300/60",
                )}
              >
                {message.citationAudit.status === "grounded" && (
                  <><ShieldCheck className="size-3 shrink-0" aria-hidden /> Claims cited against retrieved evidence</>
                )}
                {message.citationAudit.status === "declined" && (
                  <><ShieldCheck className="size-3 shrink-0" aria-hidden /> Answer declined — evidence gap acknowledged</>
                )}
                {message.citationAudit.status === "partial" && (
                  <><ShieldAlert className="size-3 shrink-0" aria-hidden />
                    Partial citations — {message.citationAudit.citedClaimCount} of {message.citationAudit.claimCount} claims cited</>
                )}
                {message.citationAudit.status === "uncited" && (
                  <><ShieldAlert className="size-3 shrink-0" aria-hidden /> Retrieved evidence was available but not cited</>
                )}
                {message.citationAudit.status === "invalid" && (
                  <><ShieldAlert className="size-3 shrink-0" aria-hidden />
                    Invalid citation{message.citationAudit.invalidIndices.length === 1 ? "" : "s"}{" "}
                    {message.citationAudit.invalidIndices.map(n => `[${n}]`).join(", ")} — not in retrieved set</>
                )}
              </p>
            )}
            {message.citations && message.citations.length > 0 && (
              <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] px-3 py-2 space-y-1.5">
                <p className="text-[0.58rem] uppercase tracking-wider text-white/30 font-semibold">
                  Sources
                </p>
                <ul className="space-y-1">
                  {message.citations.map(c => (
                      <li key={c.fragmentId} className="flex items-start gap-2 text-[0.68rem] text-white/45">
                        <span className="shrink-0 font-mono text-indigo-300/80">
                          [{c.index}]
                        </span>
                        <span className="min-w-0">
                          <span className="text-white/55 font-medium">
                            {c.documentName ?? (c.category === "document" ? "Document" : "Memory")}
                          </span>
                          <span className="text-white/30"> — {c.preview}</span>
                        </span>
                      </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        {showTimestamp && message.createdAt && !message.error && (
          <p suppressHydrationWarning className="mt-1 text-[0.6rem] text-white/25 tabular-nums select-none">
            {formatMsgTime(message.createdAt)}
          </p>
        )}
      </div>
    </div>
  );
});

// ─── WorkspaceSectionHeader ───────────────────────────────────────────────────
// Dropdown header shared by Chat, Bookmarks, Documents, and Memory views.

function WorkspaceSectionHeader({
  workspaces,
  viewWorkspaceId,
  sectionLabel,
  pickerId,
  open,
  onToggle,
  onSelect,
  subtitle,
  actions,
}: {
  workspaces: Workspace[];
  viewWorkspaceId: string | null;
  sectionLabel: string;
  pickerId: string;
  open: boolean;
  onToggle: () => void;
  onSelect: (workspaceId: string) => void;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  const viewWorkspace = workspaces.find(a => a.id === viewWorkspaceId);

  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex-1 min-w-0">
        <WorkspaceBreadcrumb
          agent={viewWorkspace}
          sectionLabel={sectionLabel}
          pickerId={pickerId}
          open={open}
          onToggle={onToggle}
          workspaces={workspaces}
          onSelectAgent={onSelect}
        />
        {subtitle}
      </div>
      {actions}
    </div>
  );
}

function BookmarkCard({
  bookmark,
  workspaceEmoji,
  onOpen,
  onRemove,
}: {
  bookmark: BookmarkEntry;
  workspaceEmoji: string;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const isUser = bookmark.role === "user" || bookmark.label === "You";
  const emojis = bookmark.emojis?.length ? bookmark.emojis : extractEmojis(bookmark.preview);
  const timestamp = bookmark.createdAt ? formatBookmarkDateTime(bookmark.createdAt) : null;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "group w-full text-left rounded-2xl border px-4 py-3.5 hover:bg-white/[0.08] transition-colors relative overflow-hidden cursor-pointer",
        bookmark.read
          ? "bg-white/[0.04] border-white/[0.08]"
          : "bg-white/7 border-indigo-400/20",
      )}
    >
      {!bookmark.read && (
        <span className="absolute left-0 top-3 bottom-3 w-[3px] rounded-full bg-indigo-400/80" />
      )}

      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-xl text-base border",
            isUser
              ? "bg-white/[0.06] border-white/[0.08]"
              : "bg-indigo-500/15 border-indigo-500/20",
          )}
          aria-hidden
        >
          {isUser ? "🙂" : workspaceEmoji}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2 mb-1">
            <div className="flex items-center gap-2 min-w-0">
              <span className={cn(
                "text-xs font-semibold truncate",
                bookmark.read ? "text-white/55" : "text-white/85",
              )}>
                {bookmark.label}
              </span>
              {!bookmark.read && (
                <span className="text-[0.58rem] uppercase tracking-wider text-indigo-400/80 font-bold shrink-0">
                  New
                </span>
              )}
            </div>
            {timestamp && (
              <span className="text-[0.62rem] text-white/35 tabular-nums shrink-0 text-right leading-tight max-w-[9rem]">
                {timestamp}
              </span>
            )}
          </div>

          <p className={cn(
            "text-sm leading-relaxed line-clamp-4",
            bookmark.read ? "text-white/55" : "text-white/80",
          )}>
            {bookmark.preview}
          </p>

          {emojis.length > 0 && (
            <p className="mt-2 flex items-center gap-1 text-base leading-none" aria-label="Emojis in message">
              {emojis.map((emoji, i) => (
                <span key={`${emoji}-${i}`} className="select-none">{emoji}</span>
              ))}
            </p>
          )}

          {bookmark.heavy && (
            <p className="mt-2 flex items-center gap-1 text-[0.65rem] text-white/35">
              <Shield className="size-2.5 shrink-0" aria-hidden />
              Contains redacted content
            </p>
          )}

          <div className="mt-3 pt-2.5 border-t border-white/[0.06] flex items-center justify-between gap-2">
            <span className="text-[0.68rem] text-white/28 group-hover:text-indigo-300/85 transition-colors flex items-center gap-1.5">
              <MessageSquare className="size-3 shrink-0" aria-hidden />
              Open in investigate
              <ChevronRight className="size-3 opacity-60 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" aria-hidden />
            </span>
            <span
              role="button"
              tabIndex={0}
              title="Remove from saved"
              aria-label="Remove from saved"
              onClick={e => { e.stopPropagation(); onRemove(); }}
              onKeyDown={e => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  onRemove();
                }
              }}
              className="flex items-center gap-1 text-[0.65rem] text-white/25 hover:text-red-400/80 transition-colors px-1.5 py-0.5 rounded-md hover:bg-red-400/10"
            >
              <Trash2 className="size-3 shrink-0" aria-hidden />
              <span className="hidden sm:inline">Remove</span>
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}

function DocumentDropZone({
  active,
  uploading,
  onBrowse,
  compact = false,
}: {
  active: boolean;
  uploading: boolean;
  onBrowse: () => void;
  compact?: boolean;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onBrowse}
      onKeyDown={e => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onBrowse();
        }
      }}
      aria-label="Upload documents"
      className={cn(
        "rounded-xl border border-dashed text-center transition-all cursor-pointer select-none",
        compact ? "px-4 py-3" : "px-5 py-8",
        active
          ? "border-indigo-400/55 bg-indigo-500/12 scale-[1.01]"
          : "border-white/10 bg-white/[0.02] hover:border-white/16 hover:bg-white/[0.04]",
        uploading && "opacity-60 pointer-events-none",
      )}
    >
      <Upload className={cn(
        "mx-auto text-indigo-300/70",
        compact ? "size-4 mb-1" : "size-7 mb-3",
      )} aria-hidden />
      <p className={cn(
        "font-medium text-white/55",
        compact ? "text-[0.78rem]" : "text-sm",
      )}>
        {active ? "Drop to upload" : compact ? "Drag files here or click to browse" : "Drag & drop files here"}
      </p>
      <p className={cn(
        "text-white/30 leading-relaxed",
        compact ? "text-[0.68rem] mt-1" : "text-xs mt-2 max-w-sm mx-auto",
      )}>
        {SUPPORTED_DOC_FORMATS_SHORT} · Max {MAX_FILE_MB} MB per file
        {!compact && " · Multiple files supported"}
      </p>
    </div>
  );
}

function DocumentCard({
  doc,
  onOpen,
  onDelete,
}: {
  doc: DocRecord;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const typeInfo = docTypeInfo(doc.mimeType);
  const isProcessing = doc.status === "processing";
  const isFailed     = doc.status === "failed";
  const isStored     = doc.status === "ready" && doc.chunkCount === 0;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={e => e.key === "Enter" && onOpen()}
      className={cn(
        "group relative rounded-2xl border p-4 cursor-pointer transition-all text-left",
        "bg-white/[0.03] border-white/[0.07]",
        "hover:bg-white/[0.06] hover:border-white/[0.12]",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/20",
      )}
    >
      <button
        type="button"
        onClick={e => { e.stopPropagation(); onDelete(); }}
        className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-lg hover:bg-red-500/15 text-white/25 hover:text-red-400"
        aria-label="Delete document"
      >
        <Trash2 className="size-3.5" aria-hidden />
      </button>

      <div className="flex items-start gap-2 mb-3 pr-5">
        <span className={cn(
          "shrink-0 rounded-md border px-1.5 py-0.5 text-[0.6rem] font-bold tracking-wider font-mono",
          typeInfo.cls,
        )}>
          {typeInfo.label}
        </span>
        <p className="text-[0.8rem] font-medium text-white/70 leading-snug line-clamp-2 break-all">
          {doc.name}
        </p>
      </div>

      {!doc.workspaceId && (
        <p className="text-[0.62rem] text-amber-400/70 mb-2">Unassigned — from a removed workspace</p>
      )}

      <div className="flex items-center gap-1.5 mb-2">
        <span className={cn(
          "size-1.5 rounded-full shrink-0",
          isProcessing ? "bg-yellow-400 animate-pulse" :
          isFailed     ? "bg-red-400" :
          isStored     ? "bg-amber-400" :
                         "bg-emerald-400",
        )} />
        <span className={cn(
          "text-[0.68rem]",
          isProcessing ? "text-yellow-400" :
          isFailed     ? "text-red-400" :
          isStored     ? "text-amber-400" :
                         "text-emerald-400",
        )}>
          {isProcessing ? "Processing…" :
           isFailed     ? "Processing failed" :
           isStored     ? "Stored · start Ollama to index" :
           `${doc.chunkCount} chunks indexed`}
        </span>
      </div>

      {doc.contentPreview && (
        <p className="text-[0.72rem] text-white/30 leading-relaxed line-clamp-3 mb-3">
          {doc.contentPreview}
        </p>
      )}

      {(doc.redactionCount ?? 0) > 0 && (
        <p className="flex items-center gap-1 text-[0.65rem] text-amber-400/75 mb-2">
          <Shield className="size-2.5 shrink-0" aria-hidden />
          {doc.redactionCount} PII {doc.redactionCount === 1 ? "item" : "items"} scrubbed at upload
        </p>
      )}

      <p className="text-[0.65rem] text-white/20 mb-3">
        {fmtBytes(doc.sizeBytes)} · {timeSince(doc.createdAt)}
      </p>

      <div className="pt-2.5 border-t border-white/[0.06] flex items-center justify-between gap-2">
        <span className="text-[0.68rem] text-white/25 group-hover:text-emerald-300/80 transition-colors flex items-center gap-1.5">
          <FileText className="size-3 shrink-0" aria-hidden />
          View details
          <ChevronRight className="size-3 opacity-60 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" aria-hidden />
        </span>
      </div>
    </div>
  );
}

// ─── VoiceBar ─────────────────────────────────────────────────────────────────
// Compact inline recorder — replaces the text-input row while the mic is active.

function VoiceBar({
  state,
  waveHistory,
  elapsed,
  liveText,
  previewPending,
  onCancel,
  onConfirm,
}: {
  state: "requesting" | "listening" | "transcribing";
  waveHistory: number[];
  elapsed: number;
  liveText: { final: string; interim: string };
  previewPending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const mm = String(Math.floor(elapsed / 60)).padStart(1, "0");
  const ss = String(elapsed % 60).padStart(2, "0");
  const isListening = state === "listening";
  const isTranscribing = state === "transcribing";
  const displayText = (liveText.final + liveText.interim).trim();

  const transcriptRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [liveText]);

  return (
    <div className="flex flex-col px-4 pt-3 pb-2 gap-2.5">
      {/* Primary: live transcript — same spot as the normal text input */}
      {isListening && (
        <div
          ref={transcriptRef}
          className="min-h-[52px] max-h-[80px] overflow-y-auto text-sm leading-relaxed"
        >
          {displayText ? (
            <p className="italic">
              <span className="text-white/40">{liveText.final}</span>
              <span className="text-white/28">{liveText.interim}</span>
              {previewPending && (
                <span className="inline-block ml-1.5 size-1.5 rounded-full bg-white/25 animate-pulse align-middle not-italic" />
              )}
            </p>
          ) : (
            <p className="text-white/22 italic">
              {previewPending ? "Listening…" : "Start speaking…"}
            </p>
          )}
        </div>
      )}

      {isTranscribing && (
        <div className="min-h-[52px] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-white/40 min-w-0">
            <Loader2 className="size-4 animate-spin text-indigo-400/70 shrink-0" />
            Transcribing…
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel transcription"
            title="Cancel transcription"
            className="shrink-0 p-1 rounded-md text-white/30 hover:text-red-400/80 hover:bg-red-400/10 transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>
      )}

      {state === "requesting" && (
        <p className="min-h-[52px] flex items-center text-sm text-white/30 animate-pulse">
          Requesting microphone…
        </p>
      )}

      {/* Secondary: compact waveform + controls */}
      {!isTranscribing && state !== "requesting" && (
        <div className="flex items-center gap-2">
          <div className="flex-1 flex items-end gap-[2px] h-5 overflow-hidden min-w-0">
            {waveHistory.map((v, i) => (
              <div
                key={i}
                className="rounded-sm"
                style={{
                  flex: "1 0 0",
                  height: `${Math.max(2, Math.round(v * 18))}px`,
                  background: v > 0.08
                    ? `oklch(0.72 0.16 ${160 + i * 1.3})`
                    : "rgba(255,255,255,0.15)",
                }}
              />
            ))}
          </div>

          <span className="shrink-0 text-xs tabular-nums text-white/35 select-none">
            {mm}:{ss}
          </span>

          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel recording"
            className="shrink-0 p-1 rounded-md text-white/30 hover:text-red-400/80 hover:bg-red-400/10 transition-colors"
          >
            <X className="size-4" />
          </button>

          <button
            type="button"
            onClick={onConfirm}
            title="Done — add transcription to message"
            aria-label="Done recording — review before send"
            className="shrink-0 p-1.5 rounded-lg text-indigo-300 bg-indigo-400/15 hover:bg-indigo-400/25 hover:text-indigo-200 transition-all cursor-pointer"
          >
            <Check className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}

// ─── WorkspaceShell ───────────────────────────────────────────────────────────

export type AnalyticsViewId = "security" | "usage" | "cost";

type AppShellProps = {
  /** When set, center pane shows full analytics (same shell, Insights rail hidden). */
  analyticsView?: AnalyticsViewId;
};

export function AppShell({ analyticsView }: AppShellProps = {}) {
  const router = useRouter();
  const isAnalytics = Boolean(analyticsView);

  // ── core state ──────────────────────────────────────────────────────────────
  const [activeNav, setActiveNav] = useState<NavId>("thread");
  const [settingsSection, setSettingsSectionState] = useState<SettingsSection>("overview");
  const [securityBackLabel, setSecurityBackLabel] = useState("Back to investigate");
  const settingsReturnSectionRef = useRef<SettingsSection | null>(null);
  const lastWorkNavRef = useRef<NavId>("thread");
  const [settingsAnimatingOut, setSettingsAnimatingOut] = useState(false);
  const [settingsEntering, setSettingsEntering] = useState(false);

  const setSettingsSection = useCallback((section: SettingsSection) => {
    setSettingsSectionState(section);
    try { localStorage.setItem(SETTINGS_SECTION_KEY, section); } catch { /* quota */ }
  }, []);

  const openSettings = useCallback((section?: SettingsSection) => {
    if (activeNav !== "settings" && activeNav !== "security-dashboard") {
      lastWorkNavRef.current = activeNav;
    }
    if (section) setSettingsSection(section);
    setActiveNav("settings");
  }, [activeNav, setSettingsSection]);

  const closeSettings = useCallback(() => {
    const dest = lastWorkNavRef.current;
    setActiveNav(dest === "settings" || dest === "security-dashboard" ? "thread" : dest);
  }, []);

  const toggleSettings = useCallback(() => {
    if (activeNav === "settings" || analyticsView) {
      setSettingsAnimatingOut(true);
      window.setTimeout(() => {
        if (analyticsView) router.push("/");
        closeSettings();
        setSettingsAnimatingOut(false);
      }, SETTINGS_TRANSITION_MS);
    } else {
      openSettings();
    }
  }, [activeNav, analyticsView, closeSettings, openSettings, router]);

  /** Non-dashboard Settings sections (Overview / Workspace / Inference). */
  const handleSettingsSectionChange = useCallback((section: SettingsSection) => {
    setSettingsSection(section);
    if (analyticsView) router.push("/");
    setActiveNav("settings");
  }, [analyticsView, router, setSettingsSection]);

  useEffect(() => {
    if ((activeNav === "settings" || analyticsView) && !settingsAnimatingOut) {
      setSettingsEntering(true);
      const id = requestAnimationFrame(() => {
        requestAnimationFrame(() => setSettingsEntering(false));
      });
      return () => cancelAnimationFrame(id);
    }
    setSettingsEntering(false);
  }, [activeNav, analyticsView, settingsAnimatingOut]);

  const openInsightsDashboard = useCallback((view: InsightsDashboard) => {
    router.push(`/analytics/${view}`);
  }, [router]);

  const exitSecurityDashboard = useCallback(() => {
    router.push("/");
  }, [router]);

  // Full Insights dashboards live under Settings — keep that menu open and
  // highlight Usage / Cost / Security while those routes are active.
  useEffect(() => {
    if (!analyticsView) return;
    setActiveNav("settings");
    if (analyticsView === "usage") setSettingsSectionState("insights-context");
    else if (analyticsView === "cost") setSettingsSectionState("insights-savings");
    else setSettingsSectionState("insights-security");
  }, [analyticsView]);

  const [groqByokDraft, setGroqByokDraft] = useState("");
  const [groqByokSaved, setGroqByokSaved] = useState(false);
  const [mode, setMode]           = useState<Mode>("Standard" as Mode);
  const [isStreaming, setIsStreaming] = useState(false);

  // ── voice input state ───────────────────────────────────────────────────────
  const [voiceState, setVoiceState]   = useState<"idle" | "requesting" | "listening" | "transcribing">("idle");
  // Rolling waveform history — values 0–1 from live mic amplitude
  const [waveHistory, setWaveHistory] = useState<number[]>(Array(80).fill(0.03));
  const [voiceElapsed, setVoiceElapsed] = useState(0);
  const [liveText, setLiveText] = useState({ final: "", interim: "" });
  const [previewPending, setPreviewPending] = useState(false);
  const voiceStateRef   = useRef<"idle" | "requesting" | "listening" | "transcribing">("idle");
  const mediaStreamRef  = useRef<MediaStream | null>(null);
  const mediaRecRef     = useRef<MediaRecorder | null>(null);
  const audioChunksRef  = useRef<Blob[]>([]);
  const audioCtxRef     = useRef<AudioContext | null>(null);
  const analyserRef     = useRef<AnalyserNode | null>(null);
  const animFrameRef    = useRef<number>(0);
  const previewIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const previewDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewBusyRef  = useRef(false);
  const lastPreviewBytesRef = useRef(0);
  const runLivePreviewRef = useRef<() => void>(() => {});
  const liveTextRef = useRef({ final: "", interim: "" });
  const composerDraftRef = useRef<Pick<ComposerVoiceInsert, "base" | "selectionStart" | "selectionEnd">>({
    base: "",
    selectionStart: 0,
    selectionEnd: 0,
  });
  const [voiceComposerInsert, setVoiceComposerInsert] = useState<ComposerVoiceInsert | null>(null);
  const transcribeAbortRef = useRef<AbortController | null>(null);
  const transcribeCancelledRef = useRef(false);
  // True whenever the voice UI bar should be visible
  const listening = voiceState !== "idle";
  const [messages, setMessages]   = useState<ChatMessage[]>([]);
  const [bookmarks, setBookmarks] = useState<BookmarkEntry[]>([]);
  // IDs of bookmarks added since the user last opened the Bookmarks tab
  const [unseenBookmarkIds, setUnseenBookmarkIds] = useState<Set<string>>(new Set());
  const [scrubLog, setScrubLog]         = useState<SessionScrubEntry[]>([]);
  // Clarifications pending injection into the next AI message
  const pendingClarifications = useRef<string[]>([]);
  const [turnCount, setTurnCount] = useState(0);
  const [routeStatsRange, setRouteStatsRange] = useState<StatsRange>("today");
  const [routeStatsWorkspaceId, setRouteStatsWorkspaceId] = useState("all");
  const [piiStatsRange, setPiiStatsRange]     = useState<StatsRange>("today");
  const [piiStatsWorkspaceId, setPiiStatsWorkspaceId] = useState("all");
  const [routeHistory, setRouteHistory]       = useState<RouteHit[]>([]);
  const [piiArchive, setPiiArchive]           = useState<SessionScrubEntry[]>([]);
  const [piiSensitivity, setPiiSensitivityState] = useState<PiiSensitivityTier>(DEFAULT_SENSITIVITY);
  const [safeTerms, setSafeTerms]             = useState<SafeTerm[]>(DEFAULT_SAFE_TERMS);
  const [pendingSend, setPendingSend]         = useState<PendingSend | null>(null);
  const [highlightedPiiRecordId, setHighlightedPiiRecordId] = useState<string | null>(null);
  const [openWorkspacePickerId, setOpenWorkspacePickerId] = useState<string | null>(null);
  const [deleteConfirmWorkspace, setDeleteConfirmWorkspace] = useState<Workspace | null>(null);
  const [deleteWithBackup, setDeleteWithBackup]     = useState(true);
  const [deleteBusy, setDeleteBusy]                 = useState(false);
  const [dismissedPiiIds, setDismissedPiiIds]       = useState<Set<string>>(new Set());
  const [showDismissedPii, setShowDismissedPii]     = useState(false);
  const toggleWorkspacePicker = useCallback((id: string) => {
    setOpenWorkspacePickerId(prev => (prev === id ? null : id));
  }, []);
  const sessionStartedAtRef                   = useRef<Date | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [sessionReady, setSessionReady]       = useState(false);
  const [sessionSaveError, setSessionSaveError] = useState<string | null>(null);

  // Session ID — set after loading from DB
  const sessionIdRef = useRef<string | null>(null);

  // ── agent state ──────────────────────────────────────────────────────────────
  const [workspaces, setWorkspaces]               = useState<Workspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [expandedWorkspaceId, setExpandedWorkspaceId] = useState<string | null>(null);
  // Which companion's content is shown in the current section (Chat, Bookmarks, etc.)
  const [viewWorkspaceId, setViewWorkspaceId] = useState<string | null>(null);
  const viewWorkspaceIdRef = useRef<string | null>(null);
  const [viewBookmarks, setViewBookmarks] = useState<BookmarkEntry[]>([]);

  const activeWorkspace  = workspaces.find(a => a.id === activeWorkspaceId) ?? null;
  const viewWorkspace    = workspaces.find(a => a.id === viewWorkspaceId) ?? null;
  const workspaceName = activeWorkspace?.name ?? DEFAULT_WORKSPACE_NAME;
  const viewWorkspaceName = viewWorkspace?.name ?? workspaceName;

  // ── intel panel + model overrides ───────────────────────────────────────────
  const [isIntelOpen,       setIsIntelOpen]       = useState(!analyticsView);
  const [railSummary, setRailSummary] = useState<{
    security: { findings: number; highRiskBlocked: number; topCategory: string | null };
    usage: { requests: number; tokens: number; groundedRate: number | null; topModel: string | null };
    cost: { estimatedCostUsd: number; avgCostPerRequest: number | null; routingSavingsUsd: number };
  } | null>(null);

  useEffect(() => {
    if (isAnalytics) setIsIntelOpen(false);
  }, [isAnalytics]);

  useEffect(() => {
    if (isAnalytics) return;
    let cancelled = false;
    fetchAnalyticsJson<{
      security: { findings: number; highRiskBlocked: number; topCategory: string | null };
      usage: { requests: number; tokens: number; groundedRate: number | null; topModel: string | null };
      cost: { estimatedCostUsd: number; avgCostPerRequest: number | null; routingSavingsUsd: number };
    }>("summary", { range: "30d", workspaceId: activeWorkspaceId })
      .then(d => {
        if (!cancelled) setRailSummary(d);
      })
      .catch(() => {
        if (!cancelled) setRailSummary(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isAnalytics, activeWorkspaceId, turnCount]);
  const [openPickerMode,    setOpenPickerMode]    = useState<string | null>(null);
  const [modeModelOverrides, setModeModelOverrides] = useState<Record<string, string>>({});
  const [modelSelectionMode, setModelSelectionMode] = useState<"auto" | "fixed">("auto");
  const [fixedModelId,       setFixedModelId]       = useState("openai/gpt-oss-120b");
  const [savingsBaselineModel, setSavingsBaselineModel] = useState(DEFAULT_SAVINGS_BASELINE);
  const savingsBaselineModelRef = useRef(DEFAULT_SAVINGS_BASELINE);

  useEffect(() => { savingsBaselineModelRef.current = savingsBaselineModel; }, [savingsBaselineModel]);

  const setSavingsBaseline = useCallback((modelId: string) => {
    setSavingsBaselineModel(modelId);
    try { localStorage.setItem(SAVINGS_BASELINE_KEY, modelId); } catch { /* quota */ }
  }, []);
  const [lastRouteInfo, setLastRouteInfo] = useState<RouteInfo | null>(null);

  // ── memory state ─────────────────────────────────────────────────────────────
  const [sessionSummary, setSessionSummary]   = useState("");
  const [extractedFacts, setExtractedFacts]   = useState<Record<string, string>>({});
  const [summarizedCount, setSummarizedCount] = useState(0);

  // Full memory view — fetched from DB when the Memory tab opens
  const [workspaceFacts,         setWorkspaceFacts]         = useState<WorkspaceFactRecord[]>([]);
  const [userFacts,          setUserFacts]           = useState<WorkspaceFactRecord[]>([]);
  const [allSessionSummaries, setAllSessionSummaries] = useState<SessionSummaryRecord[]>([]);
  const [memoryStats,        setMemoryStats]        = useState<{ semanticFragmentCount: number; documentFragmentCount: number } | null>(null);
  const [memoryLoading,      setMemoryLoading]       = useState(false);

  // Refs for access inside callbacks without stale closures
  const sessionSummaryRef  = useRef("");
  const extractedFactsRef  = useRef<Record<string, string>>({});
  const summarizedCountRef = useRef(0);
  const messagesRef        = useRef<ChatMessage[]>([]);
  const loadedWorkspaceRef     = useRef<string | null>(null);

  useEffect(() => { sessionSummaryRef.current  = sessionSummary;  }, [sessionSummary]);
  useEffect(() => { extractedFactsRef.current  = extractedFacts;  }, [extractedFacts]);
  useEffect(() => { summarizedCountRef.current = summarizedCount; }, [summarizedCount]);
  useEffect(() => { messagesRef.current        = messages;        }, [messages]);
  useEffect(() => {
    if (activeWorkspaceId && messages.length > 0) {
      writeCachedMessages(activeWorkspaceId, messages);
    }
  }, [messages, activeWorkspaceId]);
  useEffect(() => {
    activeNavRef.current = activeNav;
    // Clear the unseen badge the moment the user opens Bookmarks
    if (activeNav === "bookmarks") setUnseenBookmarkIds(new Set());
  }, [activeNav]);

  // Sync expanded agent to match the active agent whenever it changes
  useEffect(() => {
    if (activeWorkspaceId) setExpandedWorkspaceId(activeWorkspaceId);
  }, [activeWorkspaceId]);

  // ── bookmark localStorage persistence ───────────────────────────────────────
  // Load bookmarks when the active agent changes
  useEffect(() => {
    if (!activeWorkspaceId) return;
    try {
      const stored = localStorage.getItem(`sm_bm_${activeWorkspaceId}`);
      if (stored) {
        const parsed: BookmarkEntry[] = JSON.parse(stored);
        setBookmarks(parsed);
        // Restore bookmarked state on messages if they match
        setMessages(prev => prev.map(m => ({
          ...m,
          bookmarked: parsed.some(b => b.messageId === m.id),
        })));
      } else {
        setBookmarks([]);
      }
    } catch { /* ignore malformed storage */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId]);

  // Persist bookmarks whenever they change
  useEffect(() => {
    if (!activeWorkspaceId) return;
    localStorage.setItem(`sm_bm_${activeWorkspaceId}`, JSON.stringify(bookmarks));
  }, [bookmarks, activeWorkspaceId]);

  // ── memory fetch ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (activeNav !== "memory" || !viewWorkspaceId) return;
    setMemoryLoading(true);
    fetch(`/api/memory?workspaceId=${viewWorkspaceId}`)
      .then(r => r.json())
      .then(data => {
        setWorkspaceFacts(data.workspaceFacts ?? []);
        setUserFacts(data.userFacts ?? []);
        setAllSessionSummaries(data.sessionSummaries ?? []);
        setMemoryStats(data.stats ?? null);
      })
      .catch(() => { /* silently ignore — in-session data is still shown */ })
      .finally(() => setMemoryLoading(false));
  }, [activeNav, viewWorkspaceId]);

  // ── view bookmarks (per workspace) ──────────────────────────────────────────
  useEffect(() => {
    if (activeNav !== "bookmarks" || !viewWorkspaceId) return;
    try {
      const stored = localStorage.getItem(`sm_bm_${viewWorkspaceId}`);
      setViewBookmarks(stored ? JSON.parse(stored) as BookmarkEntry[] : []);
    } catch {
      setViewBookmarks([]);
    }
  }, [activeNav, viewWorkspaceId]);

  useEffect(() => { viewWorkspaceIdRef.current = viewWorkspaceId; }, [viewWorkspaceId]);

  // Load persisted routing + PII history
  useEffect(() => {
    // Must run before the archive is read so no legacy raw value reaches state.
    purgeLegacyPiiValues();
    try {
      const routes = localStorage.getItem(ROUTE_HISTORY_KEY);
      if (routes) {
        const parsed = JSON.parse(routes) as RouteHit[];
        const tagged = taggedRouteHits(parsed);
        setRouteHistory(tagged);
        if (tagged.length !== parsed.length) persistRouteHistory(tagged);
      }
      const pii = localStorage.getItem(PII_ARCHIVE_KEY);
      if (pii) setPiiArchive(JSON.parse(pii) as SessionScrubEntry[]);
      const sensitivity = localStorage.getItem(PII_SENSITIVITY_KEY);
      if (sensitivity && ["low", "balanced", "high", "extreme"].includes(sensitivity)) {
        setPiiSensitivityState(sensitivity as PiiSensitivityTier);
      }
      const storedTerms = localStorage.getItem(SAFE_TERMS_KEY);
      if (storedTerms) setSafeTerms(JSON.parse(storedTerms) as SafeTerm[]);
      const dismissed = localStorage.getItem(PII_DISMISSED_KEY);
      if (dismissed) setDismissedPiiIds(new Set(JSON.parse(dismissed) as string[]));
      const baseline = localStorage.getItem(SAVINGS_BASELINE_KEY);
      if (baseline && GROQ_MODEL_PRICING[baseline]) setSavingsBaselineModel(baseline);
      if (localStorage.getItem(GROQ_BYOK_KEY)) setGroqByokSaved(true);
      const savedSettingsSection = localStorage.getItem(SETTINGS_SECTION_KEY);
      if (savedSettingsSection && isSettingsSection(savedSettingsSection)) {
        setSettingsSectionState(savedSettingsSection);
      }
    } catch { /* ignore malformed storage */ }
  }, []);

  // Drop routing stats for deleted companions so All stays equal to the sum of individuals
  useEffect(() => {
    if (workspaces.length === 0) return;
    const known = new Set(workspaces.map(a => a.id));
    setRouteHistory(prev => {
      const next = taggedRouteHits(prev, known);
      if (next.length === prev.length) return prev;
      persistRouteHistory(next);
      return next;
    });
  }, [workspaces]);

  // ── document library state ───────────────────────────────────────────────────
  const [documents,          setDocuments]          = useState<DocRecord[]>([]);
  const [docLoading,         setDocLoading]         = useState(false);
  const [docUploading,       setDocUploading]       = useState(false);
  const [docError,           setDocError]           = useState<string | null>(null);
  const [selectedDoc,   setSelectedDoc]   = useState<DocDetail | null>(null);
  const [docDragOver,   setDocDragOver]   = useState(false);
  const docFileRef = useRef<HTMLInputElement>(null);
  const docDragCounterRef = useRef(0);

  const bottomRef    = useRef<HTMLDivElement>(null);
  // Tracks whether the first post-load scroll has happened (instant vs smooth)
  const sessionLoadedRef = useRef(false);
  // Mirrors activeNav for use inside callbacks without stale closures
  const activeNavRef = useRef<NavId>("thread");
  // Stores the message ID we want to jump to after the thread view re-renders
  const pendingScrollIdRef = useRef<string | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const composerRef    = useRef<ComposerInputHandle>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleSendRef  = useRef<(text?: string) => any>(() => {});
  const fileInputRef   = useRef<HTMLInputElement>(null);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  const emojiBtnRef    = useRef<HTMLButtonElement>(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [composerDragOver, setComposerDragOver] = useState(false);
  const composerDragCounterRef = useRef(0);
  const [knowledgeIngestNote, setKnowledgeIngestNote] = useState<string | null>(null);
  /** Avoid TDZ: handleSend is declared above the Knowledge upload helpers. */
  const ingestChatAttachmentsRef = useRef<
    (files: File[]) => Promise<{ id: string; name: string; content: string }[]>
  >(async () => []);
  const threadRef    = useRef<HTMLDivElement>(null);
  const [floatingDate, setFloatingDate] = useState<string | null>(null);
  const abortRef     = useRef<AbortController | null>(null);

  // ── Load workspaces then session on mount ────────────────────────────────────────
  useEffect(() => {
    fetch("/api/workspaces")
      .then(r => r.json())
      .then((data: Workspace[]) => {
        setWorkspaces(data);
        const savedId = typeof window !== "undefined"
          ? localStorage.getItem(ACTIVE_WORKSPACE_KEY)
          : null;
        const savedAgent = savedId ? data.find(a => a.id === savedId) : undefined;
        const target = savedAgent ?? data.find(a => a.isDefault) ?? data[0];
        if (target) {
          setActiveWorkspaceId(target.id);
          setViewWorkspaceId(target.id);
          setExpandedWorkspaceId(target.id);
          loadSession(target.id, target.name);
        }
      })
      .catch(() => setSessionLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadSession = (workspaceId: string, agentName: string) => {
    sessionStartedAtRef.current = new Date();
    const sameConversation = loadedWorkspaceRef.current === workspaceId && messagesRef.current.length > 0;
    const cached = readCachedMessages(workspaceId);

    setSessionLoading(true);
    setSessionSaveError(null);

    // Keep visible messages during dev hot-reload; swap cache when changing companions
    if (!sameConversation) {
      if (cached?.length) {
        setMessages(cached);
        setSessionReady(true);
      } else {
        setMessages([]);
        setSessionReady(false);
      }
    }

    fetch(`/api/session?workspaceId=${encodeURIComponent(workspaceId)}`)
      .then(r => {
        if (!r.ok) throw new Error(`Session load failed (${r.status})`);
        return r.json();
      })
      .then((data: {
        sessionId: string;
        messages: { id: string; role: string; content: string; createdAt?: string }[];
        sessionSummary: string;
        summarizedCount: number;
        extractedFacts: Record<string, string>;
      }) => {
        if (!data.sessionId) throw new Error("No session ID returned");
        sessionIdRef.current = data.sessionId;
        setSessionReady(true);
        loadedWorkspaceRef.current = workspaceId;

        if (data.messages.length > 0) {
          const loaded = data.messages.map(m => ({
            id:        m.id,
            role:      m.role as "user" | "assistant",
            content:   m.content,
            createdAt: m.createdAt,
          }));
          setMessages(loaded);
          writeCachedMessages(workspaceId, loaded);
        } else {
          const seed = [{
            id:        "seed",
            role:      "assistant" as const,
            content:   `Hey — I'm ${agentName}. What's on your mind?`,
            createdAt: new Date().toISOString(),
          }];
          setMessages(seed);
          writeCachedMessages(workspaceId, seed);
        }

        setSessionSummary(data.sessionSummary ?? "");
        setSummarizedCount(data.summarizedCount ?? 0);
        setExtractedFacts(data.extractedFacts ?? {});
      })
      .catch(() => {
        sessionIdRef.current = null;
        if (!sameConversation && !cached?.length) {
          setSessionReady(false);
          setSessionSaveError("Could not load your conversation — refresh the page. New messages won't be saved until this is fixed.");
          setMessages([{
            id:        "seed",
            role:      "assistant",
            content:   `Hey — I'm ${agentName}. What's on your mind?`,
            createdAt: new Date().toISOString(),
          }]);
        } else {
          setSessionSaveError("Could not refresh from server — showing cached messages.");
        }
      })
      .finally(() => setSessionLoading(false));
  };

  // Auto-scroll to bottom on new messages.
  // First scroll after load is instant (no animation from top).
  // Subsequent scrolls on new messages are smooth.
  useEffect(() => {
    if (sessionLoading) {
      // Reset flag whenever a new session starts loading so agent-switching
      // also gets an instant jump rather than a slow scroll.
      sessionLoadedRef.current = false;
      return;
    }
    if (!sessionLoadedRef.current) {
      sessionLoadedRef.current = true;
      // Jump instantly — avoids the jarring "scroll from top" animation on load
      const el = threadRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    } else {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, sessionLoading]);

  // Floating date pill: track which date section is at the top of the visible chat
  useEffect(() => {
    const container = threadRef.current;
    if (!container) return;
    const update = () => {
      const containerTop = container.getBoundingClientRect().top;
      const dividers = container.querySelectorAll<HTMLElement>("[data-date-divider]");
      let current: string | null = null;
      for (const el of dividers) {
        if (el.getBoundingClientRect().top <= containerTop + 48) {
          current = el.getAttribute("data-date-divider");
        }
      }
      setFloatingDate(current);
    };
    container.addEventListener("scroll", update, { passive: true });
    return () => container.removeEventListener("scroll", update);
  }, [activeNav]);

  useEffect(() => () => {
    abortRef.current?.abort();
    mediaRecRef.current?.stop();
    mediaStreamRef.current?.getTracks().forEach(t => t.stop());
    cancelAnimationFrame(animFrameRef.current);
    audioCtxRef.current?.close().catch(() => {});
    if (previewIntervalRef.current !== null) clearInterval(previewIntervalRef.current);
    if (previewDebounceRef.current !== null) clearTimeout(previewDebounceRef.current);
  }, []);

  // ── background memory compression ────────────────────────────────────────────
  // Fires after each streaming response. Compresses old turns into a rolling
  // summary so the context window stays small regardless of conversation length.
  const WORKING_MEMORY  = 10; // raw turns always sent verbatim
  const SUMMARIZE_EVERY = 6;  // compress when overflow exceeds this

  useEffect(() => {
    if (isStreaming) return; // wait for response to finish

    const msgs      = messagesRef.current.filter(m => m.role !== "assistant" || m.content);
    const sumCount  = summarizedCountRef.current;
    const overflow  = msgs.slice(sumCount);

    if (overflow.length <= WORKING_MEMORY + SUMMARIZE_EVERY) return;

    const toSummarize = overflow.slice(0, -WORKING_MEMORY);
    const newCount    = sumCount + toSummarize.length;

    fetch("/api/summarize", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages:        toSummarize.map(m => ({ role: m.role, content: m.content })),
        existingSummary: sessionSummaryRef.current,
        existingFacts:   extractedFactsRef.current,
        sessionId:       sessionIdRef.current,
        workspaceId:         activeWorkspaceId,
        turnsCovered:    newCount,
      }),
    })
      .then(r => r.json() as Promise<{ summary: string; facts: Record<string, string> }>)
      .then(({ summary, facts }) => {
        setSessionSummary(summary);
        setExtractedFacts(facts);
        setSummarizedCount(newCount);
        summarizedCountRef.current = newCount;
      })
      .catch(err => console.error("[memory] summarization failed:", err));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStreaming]);

  // ── voice input pipeline ─────────────────────────────────────────────────────
  // Keep voiceStateRef in sync so async callbacks read current state immediately
  useEffect(() => { voiceStateRef.current = voiceState; }, [voiceState]);
  useEffect(() => { liveTextRef.current = liveText; }, [liveText]);

  type VoiceState = "idle" | "requesting" | "listening" | "transcribing";
  const setVoiceStateSynced = useCallback((next: VoiceState) => {
    voiceStateRef.current = next;
    setVoiceState(next);
  }, []);

  // Elapsed-time counter while listening
  useEffect(() => {
    if (voiceState !== "listening") return;
    setVoiceElapsed(0);
    const id = setInterval(() => setVoiceElapsed(s => s + 1), 1000);
    return () => clearInterval(id);
  }, [voiceState]);

  // Stop all recording/animation resources without changing voiceState.
  const teardownVoiceResources = useCallback(() => {
    mediaRecRef.current?.stop();
    mediaRecRef.current = null;
    cancelAnimationFrame(animFrameRef.current);
    animFrameRef.current = 0;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    analyserRef.current = null;
    mediaStreamRef.current?.getTracks().forEach(t => t.stop());
    mediaStreamRef.current = null;
    audioChunksRef.current = [];
    if (previewIntervalRef.current !== null) {
      clearInterval(previewIntervalRef.current);
      previewIntervalRef.current = null;
    }
    if (previewDebounceRef.current !== null) {
      clearTimeout(previewDebounceRef.current);
      previewDebounceRef.current = null;
    }
    previewBusyRef.current = false;
    lastPreviewBytesRef.current = 0;
    setWaveHistory(Array(80).fill(0.03));
    setVoiceElapsed(0);
    setLiveText({ final: "", interim: "" });
    setPreviewPending(false);
  }, []);

  // Rolling live preview — sends accumulated audio to Groq Whisper.
  const runLivePreview = useCallback(async () => {
    if (voiceStateRef.current !== "listening" || previewBusyRef.current) return;
    const chunks = audioChunksRef.current;
    if (chunks.length === 0) return;

    const blob = new Blob(chunks, { type: chunks[0].type || "audio/webm" });
    if (blob.size < 2000) return; // ~1s of audio
    if (blob.size - lastPreviewBytesRef.current < 1200) return;

    previewBusyRef.current = true;
    setPreviewPending(true);
    try {
      const fd = new FormData();
      fd.append("audio", blob, "preview.webm");
      const res = await fetch("/api/transcribe", { method: "POST", body: fd });
      if (res.ok && voiceStateRef.current === "listening") {
        const { text } = await res.json() as { text: string };
        const trimmed = text?.trim() ?? "";
        if (trimmed) {
          setLiveText({ final: trimmed, interim: "" });
          lastPreviewBytesRef.current = blob.size;
        }
      }
    } catch {
      /* preview is best-effort */
    } finally {
      previewBusyRef.current = false;
      if (voiceStateRef.current === "listening") {
        setPreviewPending(false);
        // If more audio arrived while transcribing, pipeline the next pass immediately
        const pending = audioChunksRef.current;
        const pendingBlob = new Blob(pending, { type: pending[0]?.type || "audio/webm" });
        if (pendingBlob.size - lastPreviewBytesRef.current >= 1200) {
          setTimeout(() => runLivePreviewRef.current(), 150);
        }
      }
    }
  }, []);
  runLivePreviewRef.current = runLivePreview;

  const scheduleLivePreview = useCallback(() => {
    if (voiceStateRef.current !== "listening") return;
    if (previewDebounceRef.current !== null) clearTimeout(previewDebounceRef.current);
    previewDebounceRef.current = setTimeout(() => {
      previewDebounceRef.current = null;
      runLivePreviewRef.current();
    }, 300);
  }, []);

  const snapshotComposerDraft = useCallback(() => {
    const value = composerRef.current?.getValue() ?? "";
    const sel = composerRef.current?.getSelection() ?? { start: value.length, end: value.length };
    composerDraftRef.current = {
      base: value,
      selectionStart: sel.start,
      selectionEnd: sel.end,
    };
  }, []);

  const restoreComposerDraft = useCallback(() => {
    setVoiceComposerInsert({ text: "", ...composerDraftRef.current });
  }, []);

  const startVoice = useCallback(async () => {
    snapshotComposerDraft();
    setVoiceStateSynced("requesting");

    // Request mic permission (needed for MediaRecorder audio capture)
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setVoiceStateSynced("idle");
      return; // permission denied or no device
    }
    mediaStreamRef.current = stream;
    audioChunksRef.current = [];

    // MediaRecorder: captures the raw audio for Groq Whisper transcription
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/webm")
      ? "audio/webm"
      : "";
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorder.ondataavailable = e => {
      if (e.data.size > 0) audioChunksRef.current.push(e.data);
      scheduleLivePreview();
    };
    recorder.start(100); // 100 ms chunks — faster first preview
    mediaRecRef.current = recorder;

    // Live waveform from mic amplitude (same stream as MediaRecorder — no conflict)
    try {
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      await ctx.resume();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.65;
      analyserRef.current = analyser;
      ctx.createMediaStreamSource(stream).connect(analyser);

      const freqData = new Uint8Array(analyser.frequencyBinCount);
      const timeData = new Uint8Array(analyser.fftSize);
      let lastPush = 0;

      const draw = () => {
        animFrameRef.current = requestAnimationFrame(draw);
        if (voiceStateRef.current !== "listening" || !analyserRef.current) return;

        const now = performance.now();
        if (now - lastPush < 45) return;
        lastPush = now;

        analyser.getByteFrequencyData(freqData);
        analyser.getByteTimeDomainData(timeData);

        // Time-domain peak — most responsive to voice volume
        let peak = 0;
        for (let i = 0; i < timeData.length; i++) {
          const v = Math.abs(timeData[i] - 128) / 128;
          if (v > peak) peak = v;
        }

        // Speech-band energy from frequency bins (~300–3400 Hz)
        let sumSq = 0;
        const binStart = 3;
        const binEnd = Math.min(36, freqData.length);
        for (let i = binStart; i < binEnd; i++) sumSq += freqData[i] * freqData[i];
        const rms = Math.sqrt(sumSq / (binEnd - binStart)) / 255;

        const raw = peak * 0.7 + rms * 0.3;
        const amp = raw < 0.025 ? 0.04 : Math.min(0.92, raw * 1.15);

        setWaveHistory(prev => [amp, ...prev.slice(0, -1)]);
      };
      draw();
    } catch {
      /* AudioContext unavailable — bars stay at baseline */
    }

    // Live preview: event-driven on new audio + 2s safety-net interval
    lastPreviewBytesRef.current = 0;
    setLiveText({ final: "", interim: "" });
    setPreviewPending(false);
    setTimeout(() => { runLivePreviewRef.current(); }, 900);
    previewIntervalRef.current = setInterval(() => runLivePreviewRef.current(), 2000);

    setVoiceStateSynced("listening");
  }, [scheduleLivePreview, snapshotComposerDraft, setVoiceStateSynced]);

  const cancelVoice = useCallback(() => {
    if (voiceStateRef.current === "transcribing") {
      transcribeCancelledRef.current = true;
      transcribeAbortRef.current?.abort();
      transcribeAbortRef.current = null;
      setLiveText({ final: "", interim: "" });
      restoreComposerDraft();
      setVoiceStateSynced("idle");
      return;
    }
    teardownVoiceResources();
    restoreComposerDraft();
    setVoiceStateSynced("idle");
  }, [teardownVoiceResources, restoreComposerDraft, setVoiceStateSynced]);

  // confirmVoice: stop recording → POST to Groq Whisper → fill composer (user sends manually)
  const confirmVoice = useCallback(async () => {
    if (voiceStateRef.current !== "listening") return;

    // Stop live preview + waveform animation
    if (previewIntervalRef.current !== null) {
      clearInterval(previewIntervalRef.current);
      previewIntervalRef.current = null;
    }
    if (previewDebounceRef.current !== null) {
      clearTimeout(previewDebounceRef.current);
      previewDebounceRef.current = null;
    }
    setPreviewPending(false);
    cancelAnimationFrame(animFrameRef.current);
    animFrameRef.current = 0;
    setWaveHistory(Array(80).fill(0.03));
    setVoiceElapsed(0);
    setVoiceStateSynced("transcribing");
    transcribeCancelledRef.current = false;

    // Wait for MediaRecorder to finish flushing its last chunk
    await new Promise<void>(resolve => {
      const rec = mediaRecRef.current;
      if (!rec || rec.state === "inactive") { resolve(); return; }
      const prevStop = rec.onstop;
      rec.onstop = e => { if (typeof prevStop === "function") prevStop.call(rec, e); resolve(); };
      rec.stop();
    });
    if (transcribeCancelledRef.current) return;

    mediaRecRef.current = null;
    mediaStreamRef.current?.getTracks().forEach(t => t.stop());
    mediaStreamRef.current = null;

    const chunks = audioChunksRef.current.slice();
    audioChunksRef.current = [];
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;

    if (transcribeCancelledRef.current) return;

    if (chunks.length === 0) {
      setLiveText({ final: "", interim: "" });
      restoreComposerDraft();
      setVoiceStateSynced("idle");
      return;
    }

    const previewFallback = (liveTextRef.current.final + liveTextRef.current.interim).trim();
    const snap = composerDraftRef.current;

    transcribeAbortRef.current?.abort();
    const abortController = new AbortController();
    transcribeAbortRef.current = abortController;

    try {
      const blob = new Blob(chunks, { type: chunks[0].type || "audio/webm" });
      const fd = new FormData();
      fd.append("audio", blob, "recording.webm");
      const res = await fetch("/api/transcribe", {
        method: "POST",
        body: fd,
        signal: abortController.signal,
      });
      if (transcribeCancelledRef.current) return;

      if (!res.ok) throw new Error(await res.text());
      const { text } = await res.json() as { text: string };
      const trimmed = text?.trim() || previewFallback;
      setLiveText({ final: "", interim: "" });
      if (trimmed) {
        setVoiceComposerInsert({ text: trimmed, ...snap });
      } else {
        restoreComposerDraft();
      }
      setVoiceStateSynced("idle");
    } catch (err) {
      if (abortController.signal.aborted || transcribeCancelledRef.current) return;
      console.error("[voice] transcription error:", err);
      setLiveText({ final: "", interim: "" });
      if (previewFallback) {
        setVoiceComposerInsert({ text: previewFallback, ...snap });
      } else {
        restoreComposerDraft();
      }
      setVoiceStateSynced("idle");
    } finally {
      if (transcribeAbortRef.current === abortController) {
        transcribeAbortRef.current = null;
      }
    }
  }, [restoreComposerDraft, setVoiceStateSynced]);

  // ── send ─────────────────────────────────────────────────────────────────────
  const cancelStream = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const setPiiSensitivity = useCallback((tier: PiiSensitivityTier) => {
    setPiiSensitivityState(tier);
    try { localStorage.setItem(PII_SENSITIVITY_KEY, tier); } catch { /* quota */ }
  }, []);

  const addSafeTerm = useCallback((kind: SafeTermKind, value: string, label?: string) => {
    const check = validateSafeTerm(value, kind);
    if (!check.ok) return check;
    setSafeTerms(prev => {
      const next = [...prev, { id: crypto.randomUUID(), kind, value: value.trim(), label }];
      persistSafeTerms(next);
      return next;
    });
    return { ok: true } as const;
  }, []);

  const removeSafeTerm = useCallback((termId: string) => {
    setSafeTerms(prev => {
      const next = prev.filter(t => t.id !== termId);
      persistSafeTerms(next);
      return next;
    });
  }, []);

  const deliverMessage = useCallback(async ({
    raw,
    sanitized,
    segments,
    scrubEvents,
    safeTermMatches,
    hadRedactions,
    imageDataUrls,
    attachmentDocumentIds = [],
    attachmentHistoryBlock = "",
  }: DeliverPayload) => {
    const turn = turnCount + 1;
    setTurnCount(turn);

    if (hadRedactions) {
      const scrubAgentId = activeWorkspaceId ?? undefined;
      const redactions: RedactionRecord[] = scrubEvents.map(ev => ({
        id:       crypto.randomUUID(),
        category: ev.category,
        context:  sanitized.length > 120
          ? `…${sanitized.slice(0, 120)}…`
          : sanitized,
      }));
      const scrubEntry: SessionScrubEntry = {
        turn,
        events: scrubEvents,
        at: new Date().toISOString(),
        redactions,
        workspaceId: scrubAgentId,
        safeTermMatches: safeTermMatches.length > 0 ? safeTermMatches : undefined,
      };
      setScrubLog(p => [...p, scrubEntry]);
      setPiiArchive(prev => {
        const next = [...prev, scrubEntry].slice(-500);
        persistPiiArchive(next);
        return next;
      });
      void postSecurityEvents({
        workspaceId: scrubAgentId,
        sensitivity: piiSensitivity,
        events: scrubEvents.map(ev => ({
          category: ev.category,
          source: "investigate" as const,
          outcome: ev.category === "secret" ? ("blocked" as const) : ("redacted" as const),
          count: ev.count,
          resourceKind: "message" as const,
        })),
      });
    }

    const clarifications = pendingClarifications.current.splice(0);
    const baseText = clarifications.length > 0
      ? `[Context update from user: ${clarifications.join("; ")}]\n\n${sanitized}`
      : sanitized;
    // History must retain attachment text so follow-ups ("what is it about?") still work.
    const messageToSend = attachmentHistoryBlock
      ? `${baseText || "Please review the attached file(s)."}\n\n${attachmentHistoryBlock}`
      : (baseText || (imageDataUrls.length > 0 || attachmentDocumentIds.length > 0
        ? "Please review the attached file(s)."
        : ""));

    const userId = crypto.randomUUID();
    const asstId = crypto.randomUUID();

    const now = new Date().toISOString();
    setMessages(p => [
      ...p,
      {
        // Keep attachment text in message content so follow-up turns still see it
        // in working memory (UI strips the [Attached document…] block when rendering).
        id: userId, role: "user", content: messageToSend,
        createdAt: now,
        segments, scrubEvents: hadRedactions ? scrubEvents : undefined,
        images: imageDataUrls.length > 0 ? imageDataUrls : undefined,
      },
      { id: asstId, role: "assistant", content: "", createdAt: now },
    ]);
    setIsStreaming(true);

    try {
      // Persist the history-enriched text so reloads and later turns retain the file.
      await persistMessage(sessionIdRef.current!, "user", messageToSend);
    } catch (err) {
      console.error("[messages] user save failed:", err);
      setSessionSaveError("Message could not be saved. Check your connection and try again.");
      setMessages(p => p.filter(m => m.id !== userId && m.id !== asstId));
      setIsStreaming(false);
      composerRef.current?.setValue(raw);
      return;
    }

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const sendStart = Date.now();
    let ttftCaptured = false;
    let asstContent = "";

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Plain user ask for this turn; attachment bodies load via IDs server-side.
          message:           baseText || "Please review the attached file(s).",
          mode,
          workspaceId:       activeWorkspaceId ?? "",
          images:            imageDataUrls,
          attachmentDocumentIds,
          sessionId:         sessionIdRef.current ?? "local",
          sessionSummary:    sessionSummaryRef.current,
          facts:             extractedFactsRef.current,
          modelOverrides:    modelSelectionMode === "fixed"
            ? Object.fromEntries(MODES.map(m => [m, fixedModelId]))
            : modeModelOverrides,
          history: messages
            .filter(m => m.role !== "assistant" || m.content)
            .slice(summarizedCountRef.current)
            .map(m => ({ role: m.role, content: m.content })),
          lastTier: lastRouteInfo?.mode ?? null,
          priorTurnHadCitations: Boolean(
            [...messages].reverse().find(m => m.role === "assistant")?.citations?.length,
          ),
          priorTurnWasGrounded: (() => {
            const last = [...messages].reverse().find(m => m.role === "assistant");
            return Boolean(
              last?.citations?.length ||
              (last?.citationAudit && last.citationAudit.status !== "n/a"),
            );
          })(),
        }),
        signal: ctrl.signal,
      });

      if (res.status === 503) {
        const { error } = await res.json() as { error: string };
        setMessages(p => p.map(m => m.id === asstId ? { ...m, error: `Setup needed: ${error}` } : m));
        return;
      }
      if (!res.ok || !res.body) throw new Error(`Server error: ${res.status}`);

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") break;
          try {
            const parsed = JSON.parse(data) as {
              delta?: string;
              error?: string;
              route?: RouteInfo;
              citations?: CitationRef[];
              citationAudit?: CitationAuditRef;
              evidence?: { status: "insufficient" };
              showGroundingBadge?: boolean;
              usage?: { promptTokens: number; completionTokens: number };
            };
            if (parsed.citations?.length) {
              setMessages(p => p.map(m =>
                m.id === asstId ? { ...m, citations: parsed.citations } : m,
              ));
            }
            if (parsed.citationAudit) {
              setMessages(p => p.map(m =>
                m.id === asstId
                  ? {
                    ...m,
                    citationAudit: parsed.showGroundingBadge === false ? undefined : parsed.citationAudit,
                    showGroundingBadge: parsed.showGroundingBadge !== false,
                  }
                  : m,
              ));
            }
            if (parsed.evidence?.status === "insufficient") {
              setMessages(p => p.map(m =>
                m.id === asstId
                  ? {
                    ...m,
                    evidenceStatus: "insufficient",
                    showGroundingBadge: parsed.showGroundingBadge !== false,
                  }
                  : m,
              ));
            }
            if (parsed.route) {
              setMessages(p => p.map(m =>
                m.id === asstId ? { ...m, routeInfo: parsed.route } : m,
              ));
              setLastRouteInfo(parsed.route);
              const hit: RouteHit = {
                tier:    parsed.route!.mode,
                model:   parsed.route!.model,
                at:      new Date().toISOString(),
                workspaceId: activeWorkspaceId ?? undefined,
              };
              setRouteHistory(prev => {
                const next = taggedRouteHits([...prev, hit]).slice(-500);
                persistRouteHistory(next);
                return next;
              });
            }
            if (parsed.usage) {
              const u = parsed.usage;
              const target = messagesRef.current.find(m => m.id === asstId);
              if (target?.routeInfo) {
                const baseline = savingsBaselineModelRef.current;
                const { costUsd, savedUsd } = calcTurnCost(
                  target.routeInfo.model, u.promptTokens, u.completionTokens, baseline,
                );
                setRouteHistory(rh => {
                  const next = [...rh];
                  const idx = next.length - 1;
                  if (idx >= 0 && next[idx].model === target.routeInfo!.model) {
                    next[idx] = {
                      ...next[idx],
                      promptTokens: u.promptTokens,
                      completionTokens: u.completionTokens,
                      costUsd,
                      savedUsd,
                    };
                    persistRouteHistory(next);
                  }
                  return next;
                });
                setMessages(prev => prev.map(m =>
                  m.id === asstId
                    ? { ...m, routeInfo: { ...m.routeInfo!, costUsd, savedUsd } }
                    : m,
                ));
              }
            }
            if (parsed.error) {
              setMessages(p => p.map(m => m.id === asstId ? { ...m, error: parsed.error } : m));
              break;
            }
            if (parsed.delta) {
              asstContent += parsed.delta;
              if (!ttftCaptured) {
                ttftCaptured = true;
                const ttft = Date.now() - sendStart;
                setMessages(p => p.map(m =>
                  m.id === asstId
                    ? { ...m, routeInfo: m.routeInfo ? { ...m.routeInfo, latencyMs: ttft } : undefined, content: m.content + parsed.delta! }
                    : m,
                ));
              } else {
                setMessages(p => p.map(m =>
                  m.id === asstId ? { ...m, content: m.content + parsed.delta } : m,
                ));
              }
            }
          } catch { /* skip malformed line */ }
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        setMessages(p => p.map(m =>
          m.id === asstId
            ? { ...m, error: m.content.trim() ? undefined : "Stopped." }
            : m,
        ));
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      setMessages(p => p.map(m =>
        m.id === asstId
          ? {
            ...m,
            error: msg.includes("Ollama")
              ? msg
              : "Connection issue — check your GROQ_API_KEY and that the dev server is running, then try again.",
          }
          : m,
      ));
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
      setTimeout(() => composerRef.current?.focus(), 30);

      if (sessionIdRef.current) {
        const completedContent = asstContent.trim()
          || messagesRef.current.find(m => m.id === asstId)?.content?.trim()
          || "";
        if (completedContent) {
          persistMessage(sessionIdRef.current, "assistant", completedContent).catch(err => {
            console.error("[messages] assistant save failed:", err);
            setSessionSaveError("Reply may not persist after refresh.");
          });
        }
      }
    }
  }, [
    turnCount, mode, workspaceName, activeWorkspace, activeWorkspaceId, modelSelectionMode,
    fixedModelId, modeModelOverrides, messages, lastRouteInfo, piiSensitivity,
  ]);

  const handleSend = useCallback(async (textOverride?: string) => {
    const raw = (textOverride ?? composerRef.current?.getValue() ?? "").trim();
    if (!raw && attachments.length === 0) return;
    if (isStreaming) return;
    if (sessionLoading || !sessionIdRef.current) {
      setSessionSaveError("Still loading your conversation — wait a moment and try again.");
      return;
    }
    setSessionSaveError(null);
    if (voiceState !== "idle") cancelVoice();

    const pendingAttachments = [...attachments];

    // Await Knowledge ingest so scrubbed text is available for this chat turn.
    // Images also stay available for vision.
    let uploadedDocs: { id: string; name: string; content: string }[] = [];
    if (pendingAttachments.length > 0) {
      uploadedDocs = await ingestChatAttachmentsRef.current(pendingAttachments);
    }
    const attachmentDocumentIds = uploadedDocs.map(d => d.id);
    const attachmentHistoryBlock = formatAttachmentsForHistory(uploadedDocs);

    const imageFiles = pendingAttachments.filter(f => f.type.startsWith("image/"));
    const imageDataUrls: string[] = await Promise.all(
      imageFiles.map(f => new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload  = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(f);
      }))
    );

    const scrub = scrubPII(raw, { sensitivity: piiSensitivity, safeTerms });

    // Anything detected goes to review first. The composer keeps the raw text so
    // cancelling leaves the user exactly where they were.
    if (scrub.hadRedactions) {
      setPendingSend({
        raw,
        sanitized:       scrub.sanitized,
        segments:        scrub.segments,
        scrubEvents:     scrub.scrubEvents,
        safeTermMatches: scrub.safeTermMatches,
        imageDataUrls,
        attachmentDocumentIds,
        attachmentHistoryBlock,
      });
      return;
    }

    composerRef.current?.clear();
    setAttachments([]);
    await deliverMessage({
      raw,
      sanitized: scrub.sanitized,
      segments: scrub.segments,
      scrubEvents: scrub.scrubEvents,
      safeTermMatches: scrub.safeTermMatches,
      imageDataUrls,
      hadRedactions: scrub.hadRedactions,
      attachmentDocumentIds,
      attachmentHistoryBlock,
    });
  }, [
    attachments, isStreaming, sessionLoading, voiceState, cancelVoice,
    piiSensitivity, safeTerms, deliverMessage,
  ]);

  /** User accepted the redacted form. Only the sanitized text is delivered. */
  const confirmPendingSend = useCallback(async () => {
    const pending = pendingSend;
    if (!pending) return;
    setPendingSend(null);
    composerRef.current?.clear();
    setAttachments([]);
    await deliverMessage({ ...pending, hadRedactions: true });
  }, [pendingSend, deliverMessage]);

  /** User wants to rewrite. Drop the pending copy; the composer still holds the text. */
  const cancelPendingSend = useCallback(() => {
    setPendingSend(null);
    composerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!pendingSend) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); cancelPendingSend(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [pendingSend, cancelPendingSend]);
  // Keep the ref current so voice confirm can call send without stale closure
  handleSendRef.current = handleSend;

  // ── agent switching ──────────────────────────────────────────────────────────
  const switchWorkspace = useCallback((agent: Workspace) => {
    if (agent.id === activeWorkspaceId) return;
    abortRef.current?.abort();
    try { localStorage.setItem(ACTIVE_WORKSPACE_KEY, agent.id); } catch { /* private browsing */ }
    setActiveWorkspaceId(agent.id);
    setViewWorkspaceId(agent.id);
    setExpandedWorkspaceId(agent.id);
    setBookmarks([]);
    setScrubLog([]);
    pendingClarifications.current = [];
    setTurnCount(0);
    composerRef.current?.clear();
    loadSession(agent.id, agent.name);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId]);

  const handleWorkspaceClick = useCallback((agent: Workspace) => {
    if (analyticsView) {
      try {
        sessionStorage.setItem(
          PENDING_WORK_NAV_KEY,
          JSON.stringify({ nav: "thread" as NavId, workspaceId: agent.id }),
        );
      } catch { /* private browsing */ }
      router.push("/");
      return;
    }
    if (agent.id === activeWorkspaceId) {
      // Toggle expand for the already-active agent
      setExpandedWorkspaceId(prev => prev === agent.id ? null : agent.id);
    } else {
      // Switch to this agent and expand its sub-nav
      switchWorkspace(agent);
      setExpandedWorkspaceId(agent.id);
      setActiveNav("thread");
    }
  }, [activeWorkspaceId, analyticsView, router, switchWorkspace]);

  const createWorkspace = useCallback(async (draft: Partial<Workspace>) => {
    const res  = await fetch("/api/workspaces", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(draft),
    });
    const agent = await res.json() as Workspace;
    setWorkspaces(p => [...p, agent]);
    switchWorkspace(agent);
    return agent;
  }, [switchWorkspace]);

  const createNewWorkspace = useCallback(async () => {
    const agent = await createWorkspace({ name: "New workspace" });
    setViewWorkspaceId(agent.id);
    setExpandedWorkspaceId(agent.id);
    setActiveNav("workspace-settings");
  }, [createWorkspace]);

  const saveWorkspace = useCallback(async (id: string, patch: Partial<Workspace>) => {
    const res  = await fetch(`/api/workspaces/${id}`, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(patch),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string };
      throw new Error(body.error ?? `Save failed (${res.status})`);
    }
    const updated = await res.json() as Workspace;
    setWorkspaces(p => p.map(a => a.id === id ? { ...a, ...updated } : a));
  }, []);

  const deleteWorkspace = useCallback(async (id: string) => {
    const res = await fetch(`/api/workspaces/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string };
      throw new Error(body.error ?? "Could not delete workspace");
    }
    const remaining = workspaces.filter(a => a.id !== id);
    setWorkspaces(remaining);
    try { localStorage.removeItem(`sm_bm_${id}`); } catch { /* ignore */ }
    if (activeWorkspaceId === id && remaining.length > 0) {
      switchWorkspace(remaining[0]);
    }
    if (viewWorkspaceId === id && remaining.length > 0) {
      setViewWorkspaceId(remaining[0].id);
    }
  }, [workspaces, activeWorkspaceId, viewWorkspaceId, switchWorkspace]);

  const downloadWorkspaceBackup = useCallback(async (agent: Workspace) => {
    let bookmarks: unknown[] = [];
    try {
      const bm = localStorage.getItem(`sm_bm_${agent.id}`);
      if (bm) bookmarks = JSON.parse(bm) as unknown[];
    } catch { /* ignore */ }
    const payload = {
      exportedAt: new Date().toISOString(),
      version:    1,
      agent,
      bookmarks,
      note: "Workspace profile and saved conclusions export. Investigation history and knowledge remain in your database until the workspace is deleted.",
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${agent.name.replace(/\s+/g, "-").toLowerCase()}-workspace-backup.json`;
    link.click();
    URL.revokeObjectURL(url);
  }, []);

  const confirmDeleteWorkspace = useCallback(async () => {
    if (!deleteConfirmWorkspace) return;
    setDeleteBusy(true);
    try {
      if (deleteWithBackup) await downloadWorkspaceBackup(deleteConfirmWorkspace);
      await deleteWorkspace(deleteConfirmWorkspace.id);
      setDeleteConfirmWorkspace(null);
      setActiveNav("thread");
    } catch (err) {
      console.error("[workspaces] delete failed:", err);
    } finally {
      setDeleteBusy(false);
    }
  }, [deleteConfirmWorkspace, deleteWithBackup, deleteWorkspace, downloadWorkspaceBackup]);

  // ── document library ─────────────────────────────────────────────────────────

  const fetchDocuments = useCallback(async (workspaceId?: string | null) => {
    const id = workspaceId ?? viewWorkspaceIdRef.current;
    setDocLoading(true);
    setDocError(null);
    try {
      const url = id ? `/api/documents?workspaceId=${id}` : "/api/documents";
      const res = await fetch(url);
      if (res.ok) {
        setDocuments(await res.json() as DocRecord[]);
      } else {
        const body = await res.json().catch(() => null) as { error?: string } | null;
        setDocError(body?.error ?? `Could not load documents (HTTP ${res.status}). Try restarting the dev server.`);
        setDocuments([]);
      }
    } catch {
      setDocError("Could not load documents — check your connection and try again.");
      setDocuments([]);
    } finally {
      setDocLoading(false);
    }
  }, []);

  // Refetch documents when the viewed companion or Documents tab changes
  useEffect(() => {
    if (viewWorkspaceId && activeNav === "documents") fetchDocuments(viewWorkspaceId);
  }, [viewWorkspaceId, activeNav, fetchDocuments]);

  // Switch which companion's content is shown in the current section
  const selectViewWorkspace = useCallback((workspaceId: string) => {
    setViewWorkspaceId(workspaceId);
    setExpandedWorkspaceId(workspaceId);
    setOpenWorkspacePickerId(null);

    const agent = workspaces.find(a => a.id === workspaceId);
    if (!agent) return;

    if (activeNav === "thread") {
      if (workspaceId !== activeWorkspaceId) switchWorkspace(agent);
    } else if (activeNav === "documents") {
      setSelectedDoc(null);
      fetchDocuments(workspaceId);
    }
  }, [workspaces, activeNav, activeWorkspaceId, switchWorkspace, fetchDocuments]);

  /**
   * Workspace nav takes priority over Insights. On analytics routes we navigate
   * home (AppShell remounts) and restore the requested tab via sessionStorage.
   */
  const goToWorkspaceNav = useCallback((nav: NavId, agent: { id: string }) => {
    setOpenWorkspacePickerId(null);
    setViewWorkspaceId(agent.id);
    setExpandedWorkspaceId(agent.id);
    lastWorkNavRef.current =
      nav === "settings" || nav === "security-dashboard" ? "thread" : nav;

    if (analyticsView) {
      try {
        sessionStorage.setItem(
          PENDING_WORK_NAV_KEY,
          JSON.stringify({ nav, workspaceId: agent.id }),
        );
      } catch { /* private browsing */ }
      router.push("/");
      return;
    }

    setActiveNav(nav);
    if (nav === "thread") {
      const full = workspaces.find(w => w.id === agent.id);
      if (full && full.id !== activeWorkspaceId) switchWorkspace(full);
    } else if (nav === "documents") {
      fetchDocuments(agent.id);
    }
  }, [
    analyticsView,
    router,
    workspaces,
    activeWorkspaceId,
    switchWorkspace,
    fetchDocuments,
  ]);

  // Restore Chat/Knowledge/etc. after leaving an Insights dashboard.
  useEffect(() => {
    if (analyticsView || workspaces.length === 0) return;
    let pending: { nav?: string; workspaceId?: string } | null = null;
    try {
      const raw = sessionStorage.getItem(PENDING_WORK_NAV_KEY);
      if (!raw) return;
      sessionStorage.removeItem(PENDING_WORK_NAV_KEY);
      pending = JSON.parse(raw) as { nav?: string; workspaceId?: string };
    } catch {
      return;
    }
    if (!pending?.nav || !pending.workspaceId) return;
    const agent = workspaces.find(w => w.id === pending!.workspaceId);
    if (!agent) return;
    const nav = pending.nav as NavId;
    setViewWorkspaceId(agent.id);
    setExpandedWorkspaceId(agent.id);
    setActiveNav(nav);
    lastWorkNavRef.current =
      nav === "settings" || nav === "security-dashboard" ? "thread" : nav;
    if (nav === "thread" && agent.id !== activeWorkspaceId) switchWorkspace(agent);
    else if (nav === "documents") fetchDocuments(agent.id);
  }, [analyticsView, workspaces, activeWorkspaceId, switchWorkspace, fetchDocuments]);

  // Poll a single document until it leaves "processing"
  const pollDocument = useCallback((id: string, ms = 3000) => {
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/documents/${id}`);
        if (!res.ok) return;
        const updated = await res.json() as DocDetail;
        setDocuments(prev =>
          prev.map(d =>
            d.id === id
              ? { ...d, status: updated.status, chunkCount: updated.chunkCount }
              : d,
          ),
        );
        if (updated.status === "processing") pollDocument(id, ms);
      } catch {
        // ignore — let the user refresh manually
      }
    }, ms);
    return timer;
  }, []);

  const handleDocumentUpload = useCallback(async (
    file: File,
    opts?: { workspaceId?: string | null; quiet?: boolean },
  ): Promise<DocRecord | null> => {
    if (file.size > MAX_FILE_BYTES) {
      const msg =
        `"${file.name}" is ${fmtBytes(file.size)} — the limit is ${MAX_FILE_MB} MB per file. Try a smaller export or split the document.`;
      if (!opts?.quiet) setDocError(msg);
      else setKnowledgeIngestNote(msg);
      return null;
    }

    const workspaceId = opts?.workspaceId ?? viewWorkspaceIdRef.current;
    if (!opts?.quiet) {
      setDocUploading(true);
      setDocError(null);
    }
    const fd = new FormData();
    fd.append("file", file);
    if (workspaceId) fd.append("workspaceId", workspaceId);
    try {
      const res = await fetch("/api/documents", { method: "POST", body: fd });
      if (res.ok) {
        const doc = await res.json() as DocRecord;
        // Keep Knowledge list in sync when the upload belongs to the viewed workspace.
        if (!workspaceId || workspaceId === viewWorkspaceIdRef.current) {
          setDocuments(prev => [doc, ...prev.filter(d => d.id !== doc.id)]);
        }
        pollDocument(doc.id);

        if (doc.hadRedactions && doc.scrubEvents?.length) {
          const scrubEntry: SessionScrubEntry = {
            turn: 0,
            events: doc.scrubEvents,
            at: doc.createdAt,
            workspaceId: doc.workspaceId ?? undefined,
            source: "document",
            documentId: doc.id,
            documentName: doc.name,
            redactions: doc.scrubEvents.map(ev => ({
              id:       crypto.randomUUID(),
              category: ev.category,
              context:  `Document "${doc.name}"`,
            })),
          };
          setPiiArchive(prev => {
            const next = [...prev, scrubEntry].slice(-500);
            persistPiiArchive(next);
            return next;
          });
        }
        return doc;
      } else {
        const body = await res.json().catch(() => null) as { error?: string } | null;
        const msg = body?.error ?? `Upload failed (HTTP ${res.status})`;
        if (!opts?.quiet) setDocError(msg);
        else setKnowledgeIngestNote(msg);
        return null;
      }
    } catch (err) {
      const msg = `Network error: ${String(err)}`;
      if (!opts?.quiet) setDocError(msg);
      else setKnowledgeIngestNote(msg);
      console.error("[docs] upload error:", err);
      return null;
    } finally {
      if (!opts?.quiet) setDocUploading(false);
      if (docFileRef.current) docFileRef.current.value = "";
    }
  }, [pollDocument]);

  const handleDocumentFiles = useCallback(async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (!files.length) return;
    for (const file of files) {
      await handleDocumentUpload(file);
    }
  }, [handleDocumentUpload]);

  /** Chat attachments → Knowledge + return scrubbed content for this turn. */
  const ingestChatAttachmentsToKnowledge = useCallback(async (files: File[]) => {
    if (!files.length || !activeWorkspaceId) return [];
    const uploaded: { id: string; name: string; content: string }[] = [];
    for (const file of files) {
      const doc = await handleDocumentUpload(file, {
        workspaceId: activeWorkspaceId,
        quiet: true,
      });
      if (doc?.content?.trim()) {
        uploaded.push({ id: doc.id, name: doc.name, content: doc.content });
      } else if (doc) {
        // Upload succeeded but content omitted — still pass the id; chat loads from DB.
        uploaded.push({ id: doc.id, name: doc.name, content: doc.contentPreview ?? "" });
      }
    }
    if (uploaded.length > 0) {
      setKnowledgeIngestNote(
        uploaded.length === 1
          ? "Added to Knowledge — reviewing in this chat."
          : `Added ${uploaded.length} files to Knowledge — reviewing in this chat.`,
      );
      window.setTimeout(() => setKnowledgeIngestNote(null), 4000);
    }
    return uploaded;
  }, [activeWorkspaceId, handleDocumentUpload]);

  ingestChatAttachmentsRef.current = ingestChatAttachmentsToKnowledge;

  const handleComposerDragEnter = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    composerDragCounterRef.current += 1;
    if (e.dataTransfer.types.includes("Files")) setComposerDragOver(true);
  }, []);

  const handleComposerDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    composerDragCounterRef.current -= 1;
    if (composerDragCounterRef.current <= 0) {
      composerDragCounterRef.current = 0;
      setComposerDragOver(false);
    }
  }, []);

  const handleComposerDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.types.includes("Files")) e.dataTransfer.dropEffect = "copy";
  }, []);

  const handleComposerDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    composerDragCounterRef.current = 0;
    setComposerDragOver(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length) setAttachments(prev => [...prev, ...files]);
  }, []);

  const browseDocuments = useCallback(() => {
    docFileRef.current?.click();
  }, []);

  const handleDocDragEnter = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    docDragCounterRef.current += 1;
    if (e.dataTransfer.types.includes("Files")) setDocDragOver(true);
  }, []);

  const handleDocDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    docDragCounterRef.current -= 1;
    if (docDragCounterRef.current <= 0) {
      docDragCounterRef.current = 0;
      setDocDragOver(false);
    }
  }, []);

  const handleDocDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDocDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    docDragCounterRef.current = 0;
    setDocDragOver(false);
    if (e.dataTransfer.files.length) void handleDocumentFiles(e.dataTransfer.files);
  }, [handleDocumentFiles]);

  const openDocDetail = useCallback(async (id: string) => {
    const res = await fetch(`/api/documents/${id}`);
    if (res.ok) setSelectedDoc(await res.json() as DocDetail);
  }, []);

  const deleteDocument = useCallback(async (id: string) => {
    await fetch(`/api/documents/${id}`, { method: "DELETE" });
    setDocuments(prev => prev.filter(d => d.id !== id));
    if (selectedDoc?.id === id) setSelectedDoc(null);
  }, [selectedDoc]);

  // ── emoji + attachments ──────────────────────────────────────────────────────
  // Close emoji picker when clicking outside both the picker and the toggle button
  useEffect(() => {
    if (!showEmoji) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      const insidePicker = emojiPickerRef.current?.contains(t);
      const insideBtn    = emojiBtnRef.current?.contains(t);
      if (!insidePicker && !insideBtn) setShowEmoji(false);
    };
    // Use 'mousedown' but only close if NOT inside the picker
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showEmoji]);

  const onEmojiClick = useCallback((data: EmojiClickData) => {
    composerRef.current?.append(data.emoji);
    setShowEmoji(false);
    composerRef.current?.focus();
  }, []);

  // Close companion picker dropdown on outside click
  useEffect(() => {
    if (!openWorkspacePickerId) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      const root = document.querySelector(`[data-companion-picker-root="${openWorkspacePickerId}"]`);
      if (!root?.contains(t)) setOpenWorkspacePickerId(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openWorkspacePickerId]);

  const onFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length) {
      setAttachments(p => [...p, ...files]);
      // Reset so same file can be re-selected
      e.target.value = "";
    }
  }, []);

  const removeAttachment = useCallback((name: string) => {
    setAttachments(p => p.filter(f => f.name !== name));
  }, []);

  // ── bookmarks ────────────────────────────────────────────────────────────────
  const toggleBookmark = useCallback((messageId: string) => {
    const msg = messages.find(m => m.id === messageId);
    if (!msg) return;
    const already = bookmarks.some(b => b.messageId === messageId);
    if (already) {
      setBookmarks(p => p.filter(b => b.messageId !== messageId));
      setMessages(p => p.map(m => m.id === messageId ? { ...m, bookmarked: false } : m));
      // Remove from unseen if it was there
      setUnseenBookmarkIds(prev => { const s = new Set(prev); s.delete(messageId); return s; });
    } else {
      const t = msg.content.trim();
      const preview = t.length > 200 ? t.slice(0, 200) + "…" : t;
      setBookmarks(p => [...p, {
        messageId,
        label:     msg.role === "assistant" ? workspaceName : "You",
        role:      msg.role,
        preview,
        heavy:     msg.content.includes("redacted]"),
        read:      false,
        createdAt: msg.createdAt ?? new Date().toISOString(),
        emojis:    extractEmojis(t),
      }]);
      setMessages(p => p.map(m => m.id === messageId ? { ...m, bookmarked: true } : m));
      // Mark as unseen — only if the user is not already on the Bookmarks tab
      setUnseenBookmarkIds(prev =>
        activeNavRef.current === "bookmarks" ? prev : new Set([...prev, messageId]),
      );
    }
  }, [bookmarks, workspaceName, messages]);

  const removeBookmark = useCallback((workspaceId: string, messageId: string) => {
    const applyRemove = (list: BookmarkEntry[]) => list.filter(b => b.messageId !== messageId);

    if (workspaceId === activeWorkspaceId) {
      setBookmarks(applyRemove);
      setMessages(p => p.map(m => m.id === messageId ? { ...m, bookmarked: false } : m));
    }
    if (viewWorkspaceId === workspaceId) {
      setViewBookmarks(applyRemove);
    }
    setUnseenBookmarkIds(prev => {
      const s = new Set(prev);
      s.delete(messageId);
      return s;
    });

    try {
      const stored = localStorage.getItem(`sm_bm_${workspaceId}`);
      if (stored) {
        const parsed = JSON.parse(stored) as BookmarkEntry[];
        localStorage.setItem(`sm_bm_${workspaceId}`, JSON.stringify(applyRemove(parsed)));
      }
    } catch { /* ignore */ }
  }, [activeWorkspaceId, viewWorkspaceId]);

  const dismissPiiRecord = useCallback((recordId: string) => {
    setDismissedPiiIds(prev => {
      const next = new Set([...prev, recordId]);
      persistPiiDismissed(next);
      return next;
    });
  }, []);

  const deletePiiRecord = useCallback((recordId: string) => {
    const strip = (entries: SessionScrubEntry[]) =>
      entries
        .map(e => ({ ...e, redactions: e.redactions.filter(r => r.id !== recordId) }))
        .filter(e => e.redactions.length > 0);
    setScrubLog(strip);
    setPiiArchive(prev => {
      const next = strip(prev);
      persistPiiArchive(next);
      return next;
    });
    setDismissedPiiIds(prev => {
      if (!prev.has(recordId)) return prev;
      const next = new Set(prev);
      next.delete(recordId);
      persistPiiDismissed(next);
      return next;
    });
  }, []);

  useEffect(() => {
    if (activeNav === "bookmarks" && viewWorkspaceId === activeWorkspaceId) {
      setViewBookmarks(bookmarks);
    }
  }, [bookmarks, viewWorkspaceId, activeWorkspaceId, activeNav]);

  const scrollToMessage = useCallback((id: string) => {
    const agent = viewWorkspaceId ? workspaces.find(a => a.id === viewWorkspaceId) : null;
    if (agent && agent.id !== activeWorkspaceId) switchWorkspace(agent);
    pendingScrollIdRef.current = id;
    setActiveNav("thread");
    setBookmarks(prev => prev.map(b => b.messageId === id ? { ...b, read: true } : b));
    setViewBookmarks(prev => prev.map(b => b.messageId === id ? { ...b, read: true } : b));
    if (viewWorkspaceId) {
      try {
        const stored = localStorage.getItem(`sm_bm_${viewWorkspaceId}`);
        if (stored) {
          const parsed = JSON.parse(stored) as BookmarkEntry[];
          localStorage.setItem(
            `sm_bm_${viewWorkspaceId}`,
            JSON.stringify(parsed.map(b => b.messageId === id ? { ...b, read: true } : b)),
          );
        }
      } catch { /* ignore */ }
    }
  }, [viewWorkspaceId, activeWorkspaceId, workspaces, switchWorkspace]);

  const groupedViewBookmarks = useMemo(
    () => groupBookmarksByDate(viewBookmarks),
    [viewBookmarks],
  );

  // Execute the pending scroll after the thread view has painted
  useEffect(() => {
    const id = pendingScrollIdRef.current;
    if (!id || activeNav !== "thread") return;
    pendingScrollIdRef.current = null;

    // rAF ensures the thread DOM is rendered before we query it
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-message-id="${id}"]`);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      // Flash the message so the user can see which one they landed on
      setHighlightedMessageId(id);
      setTimeout(() => setHighlightedMessageId(null), 1500);
    });
  }, [activeNav]);

  // ── memory helpers (no-ops until Phase B persistence is wired) ──────────────
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const approveMemory = (_id: string) => { /* Phase B */ };
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const deleteMemory  = (_id: string) => { /* Phase B */ };

  // ── derived ──────────────────────────────────────────────────────────────────
  const totalRedactions = scrubLog.reduce((s, e) => s + e.events.reduce((ss, ev) => ss + ev.count, 0), 0);

  const filteredRouteHits = (() => {
    const known = new Set(workspaces.map(a => a.id));
    const tagged = taggedRouteHits(filterByRange(routeHistory, routeStatsRange), known);
    if (routeStatsWorkspaceId === "all") return tagged;
    return tagged.filter(h => h.workspaceId === routeStatsWorkspaceId);
  })();
  const tierUsageCounts = MODES.map(tier => ({
    tier,
    count: filteredRouteHits.filter(h => h.tier === tier).length,
    modelId: modeModelOverrides[tier] ?? DEFAULT_MODE_MODELS[tier] ?? "llama-3.3-70b-versatile",
  }));
  const totalRouteCalls = filteredRouteHits.length;

  const savingsStats = useMemo(() => {
    let totalCost = 0;
    let totalSaved = 0;
    const byModel: Record<string, { count: number; cost: number }> = {};
    const byTier: Record<string, { count: number; cost: number }> = {};
    for (const hit of filteredRouteHits) {
      const { costUsd, savedUsd } = turnCostForHit(hit, savingsBaselineModel);
      totalCost += costUsd;
      totalSaved += savedUsd;
      if (!byModel[hit.model]) byModel[hit.model] = { count: 0, cost: 0 };
      byModel[hit.model].count += 1;
      byModel[hit.model].cost += costUsd;
      if (!byTier[hit.tier]) byTier[hit.tier] = { count: 0, cost: 0 };
      byTier[hit.tier].count += 1;
      byTier[hit.tier].cost += costUsd;
    }
    const modelRows = Object.entries(byModel)
      .map(([modelId, v]) => ({ modelId, ...v }))
      .sort((a, b) => b.cost - a.cost);
    const tierRows = MODES.map(tier => ({
      tier,
      count: byTier[tier]?.count ?? 0,
      cost: byTier[tier]?.cost ?? 0,
      modelId: modeModelOverrides[tier] ?? DEFAULT_MODE_MODELS[tier] ?? DEFAULT_SAVINGS_BASELINE,
    }));
    return { totalCost, totalSaved, modelRows, tierRows, responseCount: filteredRouteHits.length };
  }, [filteredRouteHits, savingsBaselineModel, modeModelOverrides]);

  const mergedPiiEntries = (() => {
    const sessionIds = new Set(scrubLog.map(e => `${e.turn}-${e.at}`));
    const merged = [...piiArchive.filter(e => !sessionIds.has(`${e.turn}-${e.at}`)), ...scrubLog];
    return merged.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  })();
  const filteredPiiEntries = (() => {
    const byRange = filterByRange(mergedPiiEntries, piiStatsRange);
    if (piiStatsWorkspaceId === "all") return byRange;
    return byRange.filter(e => e.workspaceId === piiStatsWorkspaceId);
  })();
  const activePiiItems = filteredPiiEntries.flatMap(entry =>
    entry.redactions
      .filter(rec => !dismissedPiiIds.has(rec.id))
      .map(rec => ({ entry, rec })),
  );
  const totalPiiFiltered = activePiiItems.length;
  const piiCategoryCounts = Object.entries(
    activePiiItems.reduce<Record<string, number>>((acc, { rec }) => {
      const label = categoryLabel(rec.category);
      acc[label] = (acc[label] ?? 0) + 1;
      return acc;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);
  // Only the families the current tier actually runs — the panel must not claim
  // coverage the scrubber is not providing.
  const activePiiCategories = categoriesForTier(piiSensitivity);
  const inactivePiiCategories = allScannedCategories()
    .filter(c => !activePiiCategories.includes(c));
  const piiGroupedByDate = groupPiiByDate(
    filteredPiiEntries,
    showDismissedPii ? new Set<string>() : dismissedPiiIds,
  );
  const recentPiiItems = useMemo(() =>
    [...activePiiItems]
      .sort((a, b) => new Date(b.entry.at).getTime() - new Date(a.entry.at).getTime())
      .slice(0, 3),
  [activePiiItems]);

  const openPiiRecord = useCallback((recordId: string, workspaceId?: string) => {
    if (workspaceId) setPiiStatsWorkspaceId(workspaceId);
    setHighlightedPiiRecordId(recordId);
    setActiveNav("security-dashboard");
  }, []);

  useEffect(() => {
    if (activeNav !== "security-dashboard" || !highlightedPiiRecordId) return;
    const scrollToRecord = () => {
      const el = document.getElementById(`pii-record-${highlightedPiiRecordId}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    };
    const t1 = window.setTimeout(scrollToRecord, 80);
    const t2 = window.setTimeout(() => setHighlightedPiiRecordId(null), 4000);
    return () => { window.clearTimeout(t1); window.clearTimeout(t2); };
  }, [activeNav, highlightedPiiRecordId, piiGroupedByDate]);

  // ── intelligence panel ───────────────────────────────────────────────────────
  const IntelligencePanel = (
    <div className="flex flex-col h-full gap-0">
      {/* Header */}
      <div className="flex items-center gap-3 pb-4 mb-4 border-b border-white/[0.07] shrink-0">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl
                        bg-gradient-to-br from-indigo-500/25 to-violet-600/25
                        border border-indigo-400/20 shadow-[0_2px_12px_rgba(99,102,241,0.25)]">
          <Sparkles className="size-4 text-indigo-400" aria-hidden />
        </div>
        <div>
          <p className="text-[0.95rem] font-bold text-white/85 leading-none tracking-tight">Insights</p>
          <p className="text-[0.62rem] text-indigo-400/50 mt-0.5 font-medium">Security · Usage · Cost</p>
        </div>
      </div>

      <Tabs defaultValue="security" className="flex flex-1 min-h-0 flex-col">
        <TabsList className="grid grid-cols-3 shrink-0 bg-white/4 border border-white/6">
          <TabsTrigger value="security" className="text-xs">
            Security
            {totalRedactions > 0 && (
              <span className="ml-1 inline-flex size-4 items-center justify-center rounded-full bg-primary text-[0.55rem] text-primary-foreground font-bold">
                {totalRedactions}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="context" className="text-xs">Usage</TabsTrigger>
          <TabsTrigger value="savings" className="text-xs">Cost</TabsTrigger>
        </TabsList>

        {/* Scrollable tab body */}
        <div className="flex-1 min-h-0 overflow-y-auto mt-3">
          <TabsContent value="context" className="mt-0 space-y-2 pb-8">
            <IntelCard label="Last 30 days">
              <div className="space-y-1.5 text-xs text-white/70">
                <div className="flex justify-between gap-2">
                  <span className="text-white/45">Requests</span>
                  <span className="font-mono tabular-nums">{railSummary?.usage.requests ?? 0}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-white/45">Tokens</span>
                  <span className="font-mono tabular-nums">{railSummary?.usage.tokens ?? 0}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-white/45">Grounded answers</span>
                  <span className="font-mono tabular-nums">{fmtPct(railSummary?.usage.groundedRate)}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-white/45">Most-used model</span>
                  <span className="truncate">{shortModel(railSummary?.usage.topModel)}</span>
                </div>
              </div>
              <Link
                href="/analytics/usage"
                className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-indigo-400/35 bg-indigo-500/15 py-2.5 text-[0.72rem] font-semibold text-indigo-200/95 hover:bg-indigo-500/25 transition-colors"
              >
                <BarChart2 className="size-3.5 shrink-0" aria-hidden />
                Open full usage view
                <ChevronRight className="size-3.5 shrink-0 opacity-70" aria-hidden />
              </Link>
            </IntelCard>

            {/* Complexity usage — how often each tier was called */}
            <IntelCard label="Complexity usage">
              <WorkspaceStatsFilter
                workspaces={workspaces}
                value={routeStatsWorkspaceId}
                onChange={setRouteStatsWorkspaceId}
              />
              <StatsRangePicker value={routeStatsRange} onChange={setRouteStatsRange} />
              <p className="text-[0.62rem] text-white/30 mt-2 mb-2">
                {totalRouteCalls === 0
                  ? routeStatsWorkspaceId === "all"
                    ? "No AI responses yet for this range."
                    : "No responses for this workspace in this range."
                  : `${totalRouteCalls} response${totalRouteCalls !== 1 ? "s" : ""} routed`}
              </p>
              <div className="space-y-1">
                {tierUsageCounts.map(({ tier, count, modelId }) => (
                  <div
                    key={tier}
                    className={cn(
                      "flex items-center justify-between gap-2 rounded-lg px-2 py-1.5",
                      count > 0 ? "bg-white/[0.04]" : "opacity-45",
                    )}
                  >
                    <div className="min-w-0">
                      <span className="text-xs font-medium text-white/70">{tier}</span>
                      <p className="text-[0.62rem] text-white/35 truncate">{displayModelLabel(modelId)}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {count > 0 && Array.from({ length: Math.min(count, 8) }).map((_, i) => (
                        <span key={i} className="size-1.5 rounded-full bg-indigo-400/70" aria-hidden />
                      ))}
                      <span className={cn(
                        "min-w-[1.25rem] text-center text-[0.7rem] font-mono font-semibold tabular-nums rounded-md px-1.5 py-0.5",
                        count > 0 ? "bg-indigo-500/20 text-indigo-300" : "bg-white/5 text-white/25",
                      )}>
                        {count}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </IntelCard>

            {/* Last response routing */}
            {lastRouteInfo && (
              <IntelCard label="Last response">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={cn(
                      "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[0.6rem] font-mono font-semibold uppercase tracking-wide",
                      lastRouteInfo.provider === "groq"
                        ? "text-indigo-400/80 bg-indigo-400/10 border border-indigo-400/15"
                        : "text-emerald-400/70 bg-emerald-400/8 border border-emerald-400/15",
                    )}>
                      <Zap className="size-2.5 shrink-0" aria-hidden />
                      {lastRouteInfo.provider === "ollama" ? "local" : lastRouteInfo.provider}
                    </span>
                    <code className="text-[0.65rem] font-mono text-white/50">{displayModelLabel(lastRouteInfo.model)}</code>
                    {lastRouteInfo.wasAutoRouted && (
                      <span className="text-[0.55rem] text-indigo-400/50 font-mono uppercase tracking-wide">auto</span>
                    )}
                  </div>
                  {lastRouteInfo.latencyMs !== undefined && (
                    <p className="text-[0.65rem] text-white/30 tabular-nums">
                      TTFT:{" "}
                      <span className="text-white/50 font-mono">
                        {lastRouteInfo.latencyMs < 1000
                          ? `${lastRouteInfo.latencyMs}ms`
                          : `${(lastRouteInfo.latencyMs / 1000).toFixed(1)}s`}
                      </span>
                    </p>
                  )}
                </div>
              </IntelCard>
            )}

            {/* ── Model selection mode ─────────────────────────────────────────── */}
            <IntelCard label="Model">
              {/* Toggle: Auto vs Fixed — mutually exclusive modes */}
              <div className="flex gap-1 p-0.5 bg-white/5 rounded-lg mb-2 border border-white/6">
                <button
                  type="button"
                  onClick={() => setModelSelectionMode("auto")}
                  className={cn(
                    "flex-1 text-[0.7rem] font-medium rounded-md py-1.5 transition-all duration-150 cursor-pointer",
                    modelSelectionMode === "auto"
                      ? "bg-indigo-500/25 text-indigo-200 shadow-sm ring-1 ring-indigo-400/30"
                      : "text-white/35 hover:text-white/60",
                  )}
                >
                  Complexity tiers
                </button>
                <button
                  type="button"
                  onClick={() => setModelSelectionMode("fixed")}
                  className={cn(
                    "flex-1 text-[0.7rem] font-medium rounded-md py-1.5 transition-all duration-150 cursor-pointer",
                    modelSelectionMode === "fixed"
                      ? "bg-indigo-500/25 text-indigo-200 shadow-sm ring-1 ring-indigo-400/30"
                      : "text-white/35 hover:text-white/60",
                  )}
                >
                  Fixed model
                </button>
              </div>

              {modelSelectionMode === "auto" ? (
                <p className="text-[0.65rem] leading-relaxed text-indigo-300/75 bg-indigo-500/10 border border-indigo-500/20 rounded-lg px-2.5 py-2 mb-3">
                  <span className="font-semibold text-indigo-200">Complexity tiers active.</span>{" "}
                  Each message is auto-classified, then routed to the model mapped below for that tier.
                </p>
              ) : (
                <p className="text-[0.65rem] leading-relaxed text-amber-300/75 bg-amber-500/10 border border-amber-500/20 rounded-lg px-2.5 py-2 mb-3">
                  <span className="font-semibold text-amber-200">Fixed model active.</span>{" "}
                  Every message uses one model — complexity tiers are not used for routing.
                </p>
              )}

              {/* Fixed model picker */}
              {modelSelectionMode === "fixed" && (
                <div className="space-y-1 mb-1">
                  <p className="text-[0.65rem] text-white/35 mb-2">
                    Every message uses this model regardless of complexity.
                  </p>
                  <div className="rounded-xl bg-black/30 border border-white/8 overflow-hidden">
                    {SELECTABLE_MODELS.map(opt => {
                      const isSel = fixedModelId === opt.id;
                      return (
                        <button
                          key={opt.id}
                          onClick={() => setFixedModelId(opt.id)}
                          className={cn(
                            "w-full flex items-center justify-between px-3 py-2 text-xs transition-all",
                            isSel
                              ? "bg-indigo-500/15 text-white/85"
                              : "text-white/40 hover:bg-white/5 hover:text-white/70",
                          )}
                        >
                          <div className="flex items-center gap-2">
                            {isSel
                              ? <Check className="size-3 text-indigo-400 shrink-0" />
                              : <span className="size-3 shrink-0" />}
                            <span className="font-medium">{opt.label}</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[0.6rem] text-white/20 font-mono">{opt.speed}</span>
                            <span className={cn(
                              "text-[0.55rem] font-mono px-1 py-0.5 rounded",
                              opt.tier === "$"
                                ? "text-emerald-400/55 bg-emerald-400/8"
                                : opt.tier === "$$"
                                  ? "text-yellow-400/55 bg-yellow-400/8"
                                  : "text-orange-400/55 bg-orange-400/8",
                            )}>
                              {opt.tier}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Complexity tier table — shown in auto mode */}
              {modelSelectionMode === "auto" && (
              <>
              <div className="space-y-0.5">
                {MODES.map((m) => {
                  const defaultModelId = DEFAULT_MODE_MODELS[m] ?? "llama-3.3-70b-versatile";
                  const activeModelId  = modeModelOverrides[m] ?? defaultModelId;
                  const isPickerOpen   = openPickerMode === m;
                  const hasOverride    = !!modeModelOverrides[m];

                  return (
                    <div key={m}>
                      <button
                        onClick={() => setOpenPickerMode(isPickerOpen ? null : m)}
                        className={cn(
                          "w-full flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 -mx-0.5 group",
                          "hover:bg-white/6 active:bg-white/8 transition-all duration-150 cursor-pointer",
                          isPickerOpen && "bg-white/5",
                        )}
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-medium text-white/35 group-hover:text-white/60 transition-colors">
                            {m}
                          </span>
                          {hasOverride && (
                            <span className="text-[0.5rem] uppercase tracking-wider text-amber-400/60 bg-amber-400/8 border border-amber-400/15 px-1 py-0.5 rounded">
                              custom
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <code className={cn(
                            "text-[0.62rem] font-mono px-1.5 py-0.5 rounded transition-colors truncate max-w-[9rem]",
                            hasOverride
                              ? "text-amber-400/80 bg-amber-400/10"
                              : "text-white/35 bg-white/4",
                          )}>
                            {displayModelLabel(activeModelId)}
                          </code>
                          <ChevronRight className={cn(
                            "size-3 transition-all duration-200",
                            isPickerOpen
                              ? "text-white/40 rotate-90"
                              : "text-transparent group-hover:text-white/20",
                          )} />
                        </div>
                      </button>

                      {/* Inline model picker */}
                      {isPickerOpen && (
                        <div className="mt-1 mb-1.5 rounded-xl bg-black/30 border border-white/8 overflow-hidden">
                          {SELECTABLE_MODELS.map(opt => {
                            const isSel = activeModelId === opt.id;
                            return (
                              <button
                                key={opt.id}
                                onClick={() => {
                                  setModeModelOverrides(prev => {
                                    const next = { ...prev };
                                    if (opt.id === DEFAULT_MODE_MODELS[m]) {
                                      delete next[m];
                                    } else {
                                      next[m] = opt.id;
                                    }
                                    return next;
                                  });
                                  setOpenPickerMode(null);
                                }}
                                className={cn(
                                  "w-full flex items-center justify-between px-3 py-2 text-xs transition-all",
                                  isSel
                                    ? "bg-indigo-500/15 text-white/85"
                                    : "text-white/40 hover:bg-white/5 hover:text-white/70",
                                )}
                              >
                                <div className="flex items-center gap-2">
                                  {isSel
                                    ? <Check className="size-3 text-indigo-400 shrink-0" />
                                    : <span className="size-3 shrink-0" />}
                                  <span className="font-medium">{opt.label}</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <span className="text-[0.6rem] text-white/20 font-mono">{opt.speed}</span>
                                  <span className={cn(
                                    "text-[0.55rem] font-mono px-1 py-0.5 rounded",
                                    opt.tier === "$"
                                      ? "text-emerald-400/55 bg-emerald-400/8"
                                      : opt.tier === "$$"
                                        ? "text-yellow-400/55 bg-yellow-400/8"
                                        : "text-orange-400/55 bg-orange-400/8",
                                  )}>
                                    {opt.tier}
                                  </span>
                                </div>
                              </button>
                            );
                          })}
                          {hasOverride && (
                            <button
                              onClick={() => {
                                setModeModelOverrides(prev => {
                                  const next = { ...prev };
                                  delete next[m];
                                  return next;
                                });
                                setOpenPickerMode(null);
                              }}
                              className="w-full py-1.5 text-center text-[0.6rem] text-white/20 hover:text-white/50 border-t border-white/6 transition-colors"
                            >
                              Reset to default
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              </>
              )}
            </IntelCard>
          </TabsContent>


          <TabsContent value="security" className="mt-0 space-y-2 pb-8">
            <IntelCard label="Last 30 days">
              <div className="space-y-1.5 text-xs text-white/70">
                <div className="flex justify-between gap-2">
                  <span className="text-white/45">Findings</span>
                  <span className="font-mono tabular-nums">{railSummary?.security.findings ?? 0}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-white/45">High-risk blocked</span>
                  <span className="font-mono tabular-nums">{railSummary?.security.highRiskBlocked ?? 0}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-white/45">Most common</span>
                  <span className="truncate">{railSummary?.security.topCategory ?? "—"}</span>
                </div>
              </div>
              <Link
                href="/analytics/security"
                className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-indigo-400/35 bg-indigo-500/15 py-2.5 text-[0.72rem] font-semibold text-indigo-200/95 hover:bg-indigo-500/25 transition-colors"
              >
                <Shield className="size-3.5 shrink-0" aria-hidden />
                Open full security view
                <ChevronRight className="size-3.5 shrink-0 opacity-70" aria-hidden />
              </Link>
            </IntelCard>

            <IntelCard label="PII protection">
              <div className="flex gap-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-3 py-2.5">
                <ShieldCheck className="size-4 text-emerald-400 shrink-0 mt-0.5" aria-hidden />
                <div>
                  <p className="text-xs font-semibold text-emerald-200/90">
                    {activePiiCategories.length} pattern type{activePiiCategories.length !== 1 ? "s" : ""} active
                  </p>
                  <p className="text-[0.62rem] text-white/40 leading-relaxed mt-0.5">
                    Detection runs in your browser before send. Anything found is shown for review,
                    and only the redacted text is transmitted.
                  </p>
                </div>
              </div>
            </IntelCard>

            <IntelCard label="PII detected">
              <StatsRangePicker value={piiStatsRange} onChange={setPiiStatsRange} />
              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-3xl font-bold tabular-nums text-white/90">{totalPiiFiltered}</span>
                <span className="text-xs text-white/40">
                  item{totalPiiFiltered !== 1 ? "s" : ""} scrubbed
                </span>
              </div>
              {piiCategoryCounts.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {piiCategoryCounts.map(([label, count]) => (
                    <span
                      key={label}
                      className="inline-flex items-center gap-1 rounded-full bg-red-400/10 border border-red-400/20 px-2 py-0.5 text-[0.62rem] text-red-300/80"
                    >
                      {label}
                      <span className="font-mono font-semibold tabular-nums">{count}</span>
                    </span>
                  ))}
                </div>
              )}
              {recentPiiItems.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  <p className="text-[0.58rem] uppercase tracking-wider text-white/30 font-semibold">
                    Recent
                  </p>
                  <ul className="space-y-1">
                    {recentPiiItems.map(({ entry, rec }) => {
                      const ag = workspaceDisplay(workspaces, entry.workspaceId);
                      return (
                        <li key={rec.id}>
                          <button
                            type="button"
                            onClick={() => openPiiRecord(rec.id, entry.workspaceId)}
                            className="w-full text-left rounded-lg border border-white/8 bg-white/[0.03] px-2.5 py-2 hover:bg-white/[0.06] hover:border-indigo-500/25 transition-colors cursor-pointer group"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[0.62rem] font-medium text-red-300/80 truncate">
                                {categoryLabel(rec.category)}
                              </span>
                              <span className="text-[0.58rem] text-white/25 tabular-nums shrink-0">
                                {formatDateDivider(entry.at) === "Today"
                                  ? formatMsgTime(entry.at)
                                  : formatDateDivider(entry.at)}
                              </span>
                            </div>
                            <p className="text-[0.6rem] text-white/35 font-mono truncate mt-0.5 group-hover:text-white/50">
                              {rec.context}
                            </p>
                            <p className="text-[0.55rem] text-white/25 mt-0.5 truncate">
                              {ag.emoji && <span aria-hidden>{ag.emoji} </span>}
                              {ag.name}
                            </p>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
              {totalPiiFiltered > 0 && (
                <p className="mt-2.5 flex items-center gap-1.5 text-[0.62rem] text-amber-400/70">
                  <ShieldAlert className="size-3 shrink-0" aria-hidden />
                  Sensitive data was blocked before send
                </p>
              )}
            </IntelCard>
          </TabsContent>

          {/* ── Savings tab ─────────────────────────────────────────────────── */}
          <TabsContent value="savings" className="mt-0 space-y-2 pb-8">
            <IntelCard label="Last 30 days">
              <div className="space-y-1.5 text-xs text-white/70">
                <div className="flex justify-between gap-2">
                  <span className="text-white/45">Estimated cost</span>
                  <span className="font-mono tabular-nums">{fmtAnalyticsUsd(railSummary?.cost.estimatedCostUsd)}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-white/45">Avg / request</span>
                  <span className="font-mono tabular-nums">{fmtAnalyticsUsd(railSummary?.cost.avgCostPerRequest)}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-white/45">Routing savings (est.)</span>
                  <span className="font-mono tabular-nums">{fmtAnalyticsUsd(railSummary?.cost.routingSavingsUsd)}</span>
                </div>
              </div>
              <p className="text-[0.58rem] text-white/30 mt-2 leading-relaxed">
                Estimated AI inference cost only — not AWS or infrastructure spend.
              </p>
              <Link
                href="/analytics/cost"
                className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 py-2.5 text-[0.72rem] font-semibold text-emerald-200/90 hover:bg-emerald-500/20 transition-colors"
              >
                <BarChart2 className="size-3.5 shrink-0" aria-hidden />
                Open full cost view
                <ChevronRight className="size-3.5 shrink-0 opacity-70" aria-hidden />
              </Link>
            </IntelCard>

            <IntelCard label="Session cost (this browser)">
              <WorkspaceStatsFilter
                workspaces={workspaces}
                value={routeStatsWorkspaceId}
                onChange={setRouteStatsWorkspaceId}
              />
              <StatsRangePicker value={routeStatsRange} onChange={setRouteStatsRange} />
              {savingsStats.responseCount === 0 ? (
                <p className="text-[0.62rem] text-white/30 mt-2 py-4 text-center">
                  No routed responses in this range — send a message to start tracking.
                </p>
              ) : (
                <>
                  <div className="mt-3 flex items-baseline justify-between gap-2">
                    <span className="text-xs text-white/45">Total cost</span>
                    <span className="text-2xl font-bold font-mono tabular-nums text-white/90">
                      {fmtUsd(savingsStats.totalCost)}
                    </span>
                  </div>
                  <p className="text-[0.58rem] text-white/28 mt-1 tabular-nums">
                    {savingsStats.responseCount} response{savingsStats.responseCount !== 1 ? "s" : ""} · Groq list pricing
                  </p>
                </>
              )}
            </IntelCard>

            {savingsStats.responseCount > 0 && (
              <>
                <IntelCard label="Compare vs">
                  <p className="text-[0.58rem] text-white/32 mb-2 leading-relaxed">
                    Pick a baseline model — savings show what you avoided by not using it for every response.
                  </p>
                  <SavingsBaselinePicker
                    value={savingsBaselineModel}
                    onChange={setSavingsBaseline}
                  />
                  <div className="flex items-baseline justify-between gap-2 mt-1">
                    <span className="text-xs text-white/45">
                      Saved vs {displayModelLabel(savingsBaselineModel)}
                    </span>
                    <span className={cn(
                      "text-lg font-bold font-mono tabular-nums",
                      savingsStats.totalSaved > 0 ? "text-emerald-400/90" : "text-white/35",
                    )}>
                      {fmtUsd(savingsStats.totalSaved)}
                    </span>
                  </div>
                </IntelCard>

                <IntelCard label="By model">
                  <p className="text-[0.58rem] text-white/32 mb-2 leading-relaxed">
                    Actual model billed per response — each row is real spend on that Groq model.
                  </p>
                  <div className="space-y-1">
                    {savingsStats.modelRows.map(({ modelId, count, cost }) => (
                      <div
                        key={modelId}
                        className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 bg-white/[0.04]"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-white/70 truncate">{displayModelLabel(modelId)}</p>
                          <p className="text-[0.6rem] text-white/30 tabular-nums">
                            {count} call{count !== 1 ? "s" : ""} · {fmtUsd(cost / count)} avg
                          </p>
                        </div>
                        <span className="text-xs font-mono font-semibold tabular-nums text-white/55 shrink-0">
                          {fmtUsd(cost)}
                        </span>
                      </div>
                    ))}
                  </div>
                </IntelCard>

                {modelSelectionMode === "auto" && (
                  <IntelCard label="By complexity tier">
                    <p className="text-[0.58rem] text-white/32 mb-2 leading-relaxed">
                      * Auto-classified tier (Max, Micro, etc.) per message — not the model itself.
                      Cost reflects whichever model that tier was mapped to at call time; change mappings in Context.
                    </p>
                    <div className="space-y-1">
                      {savingsStats.tierRows.filter(t => t.count > 0).map(({ tier, count, cost, modelId }) => (
                        <div
                          key={tier}
                          className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 bg-white/[0.04]"
                        >
                          <div className="min-w-0">
                            <span className="text-xs font-medium text-white/70">{tier}</span>
                            <p className="text-[0.62rem] text-white/35 truncate">{displayModelLabel(modelId)}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-[0.65rem] font-mono tabular-nums text-white/50">{fmtUsd(cost)}</p>
                            <p className="text-[0.58rem] text-white/25 tabular-nums">{count}×</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </IntelCard>
                )}
              </>
            )}
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );

  // ── render ───────────────────────────────────────────────────────────────────

  // On full Insights routes, keep the Settings → Insights sidebar open while the
  // center pane shows the dashboard (not the Settings hub overlay).
  const onAnalytics = Boolean(analyticsView);
  const settingsVisible = activeNav === "settings" || settingsAnimatingOut || onAnalytics;
  const settingsExpanded = (activeNav === "settings" || onAnalytics) && !settingsAnimatingOut;
  const settingsNavExpanded = settingsExpanded && !settingsEntering;
  const settingsContentShown =
    activeNav === "settings" && !settingsAnimatingOut && !settingsEntering && !onAnalytics;
  const workContentShown = onAnalytics || !settingsVisible || settingsAnimatingOut;
  const workNav: NavId = activeNav === "settings" ? lastWorkNavRef.current : activeNav;
  const headerWorkNav: NavId = workNav;

  return (
    <div className="flex h-dvh overflow-hidden bg-background">

      {deleteConfirmWorkspace && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-[#0e0e14] border border-white/10 p-6 shadow-2xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-red-500/15 border border-red-500/25">
                <Trash2 className="size-5 text-red-400" aria-hidden />
              </div>
              <div>
                <h2 className="text-base font-bold text-white/90">Remove {deleteConfirmWorkspace.name}?</h2>
                <p className="text-sm text-white/45 mt-1.5 leading-relaxed">
                  All contents for this workspace will be permanently deleted — investigations, memory, knowledge, and saved conclusions.
                </p>
              </div>
            </div>
            <label className="flex items-start gap-2.5 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={deleteWithBackup}
                onChange={e => setDeleteWithBackup(e.target.checked)}
                className="mt-0.5 accent-indigo-500"
              />
              <span className="text-xs text-white/50 leading-relaxed">
                Download a backup file first (profile + saved conclusions). Investigation history in the database is not included in this export yet.
              </span>
            </label>
            <div className="flex gap-2 justify-end pt-1">
              <Button
                type="button"
                variant="ghost"
                className="text-white/50"
                disabled={deleteBusy}
                onClick={() => setDeleteConfirmWorkspace(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                className="bg-red-600 hover:bg-red-500 text-white"
                disabled={deleteBusy}
                onClick={() => void confirmDeleteWorkspace()}
              >
                {deleteBusy ? "Removing…" : "Remove permanently"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {pendingSend && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="presend-title"
        >
          <div className="w-full max-w-lg rounded-2xl bg-[#0e0e14] border border-white/10 p-6 shadow-2xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 border border-amber-500/25">
                <ShieldAlert className="size-5 text-amber-400" aria-hidden />
              </div>
              <div className="min-w-0">
                <h2 id="presend-title" className="text-base font-bold text-white/90">
                  Review before sending
                </h2>
                <p className="text-sm text-white/45 mt-1.5 leading-relaxed">
                  These values were detected and will be replaced before your message leaves this
                  device. The original text stays in the composer.
                </p>
              </div>
            </div>

            <ul className="flex flex-wrap gap-2">
              {pendingSend.scrubEvents.map(ev => (
                <li
                  key={ev.category}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-400/25 bg-red-400/10 px-2.5 py-1 text-[0.68rem] text-red-300/90"
                >
                  {categoryLabel(ev.category)}
                  <span className="tabular-nums text-red-300/60">×{ev.count}</span>
                </li>
              ))}
            </ul>

            <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2.5 max-h-48 overflow-y-auto">
              <p className="text-[0.58rem] uppercase tracking-wider text-white/30 mb-1.5">
                What will be sent
              </p>
              <p className="text-xs text-white/65 font-mono leading-relaxed whitespace-pre-wrap break-words">
                {pendingSend.sanitized}
              </p>
            </div>

            {pendingSend.safeTermMatches.length > 0 && (
              <p className="text-[0.65rem] text-white/35 leading-relaxed">
                {pendingSend.safeTermMatches.reduce((n, m) => n + m.count, 0)} further match
                {pendingSend.safeTermMatches.reduce((n, m) => n + m.count, 0) === 1 ? " was" : "es were"}
                {" "}left in place by your safe terms.
              </p>
            )}

            <div className="flex gap-2 justify-end pt-1">
              <Button
                type="button"
                variant="ghost"
                className="text-white/50"
                onClick={cancelPendingSend}
              >
                Cancel and edit
              </Button>
              <Button
                type="button"
                autoFocus
                className="bg-indigo-600 hover:bg-indigo-500 text-white"
                onClick={() => void confirmPendingSend()}
              >
                Send redacted
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Left sidebar ─────────────────────────────────────────────────── */}
      <aside className="hidden md:flex w-72 shrink-0 flex-col border-r border-white/6 bg-sidebar">

        {/* Brand header */}
        <div className="px-4 pt-5 pb-4 border-b border-white/[0.07] shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl
                            bg-gradient-to-br from-indigo-500 to-violet-600
                            shadow-[0_4px_20px_rgba(99,102,241,0.45)]">
              <span className="text-sm font-extrabold tracking-tight text-white">SM</span>
            </div>
            <div className="min-w-0">
              <p className="text-[0.95rem] font-bold text-white/90 leading-none tracking-tight">SecureMind</p>
              <p className="text-[0.65rem] text-indigo-400/60 mt-0.5 font-medium">AI Workspace</p>
            </div>
          </div>
        </div>

        {/* Workspaces + optional settings nav */}
        <div className="flex flex-col flex-1 min-h-0">
          <div className="flex flex-col gap-1 px-2.5 py-3 overflow-y-auto flex-1 min-h-0">
          <div className="flex items-center justify-between px-1.5 mb-2">
            <p className="text-[0.58rem] uppercase tracking-[0.28em] text-white/35 font-semibold">Workspaces</p>
            <button
              onClick={() => { void createNewWorkspace(); }}
              className="flex size-6 items-center justify-center rounded-lg text-white/35 hover:text-white/70 hover:bg-white/6 transition-colors cursor-pointer"
              title="New workspace"
            >
              <span className="text-base leading-none">+</span>
            </button>
          </div>

          {workspaces.map(agent => {
            const isViewing = agent.id === viewWorkspaceId;
            const isExpanded = expandedWorkspaceId === agent.id;

            return (
              <div key={agent.id} className="rounded-xl">
                {/* Workspace row — avatar customizes; name+chevron expand/switch */}
                <div className={cn(
                  "flex w-full items-center gap-1.5 px-1.5 py-1.5 rounded-xl transition-colors",
                  isViewing ? "bg-white/[0.07]" : "hover:bg-white/[0.04]",
                )}>
                  <button
                    type="button"
                    onClick={e => {
                      e.stopPropagation();
                      goToWorkspaceNav("workspace-settings", agent);
                    }}
                    className="flex size-9 shrink-0 items-center justify-center rounded-xl text-base transition-all hover:ring-2 hover:ring-white/20 hover:scale-[1.06] active:scale-100 cursor-pointer"
                    style={{ backgroundColor: agent.color + "28", border: `1px solid ${agent.color}55` }}
                    title={`Workspace settings · ${agent.name}`}
                  >
                    {agent.emoji}
                  </button>

                  <button
                    type="button"
                    onClick={() => handleWorkspaceClick(agent)}
                    className="flex flex-1 min-w-0 items-center gap-1.5 rounded-lg px-1.5 py-1.5 text-left cursor-pointer"
                  >
                    <p className={cn(
                      "flex-1 min-w-0 text-[0.875rem] font-semibold truncate leading-snug",
                      isViewing ? "text-white/92" : "text-white/55",
                    )}>{agent.name}</p>
                    <ChevronRight className={cn(
                      "size-4 shrink-0 transition-transform duration-200",
                      isViewing ? "text-white/45" : "text-white/25",
                      isExpanded && "rotate-90",
                    )} aria-hidden />
                  </button>
                </div>

                {/* Sub-nav — animated accordion */}
                <div className={cn(
                  "grid transition-all duration-300 ease-in-out",
                  isExpanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
                )}>
                  <div className="overflow-hidden">
                    <div className="ml-4 mt-1 mb-1.5 flex flex-col gap-0.5 border-l-2 border-white/[0.08] pl-2">
                      {SUB_NAV_ITEMS.map(item => {
                        const Icon = item.icon;
                        const isNavActive = activeNav === item.id && viewWorkspaceId === agent.id;
                        const badge = item.id === "bookmarks" && agent.id === activeWorkspaceId
                          ? unseenBookmarkIds.size
                          : 0;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => goToWorkspaceNav(item.id as NavId, agent)}
                            className={cn(
                              "group flex w-full items-center gap-2 rounded-lg px-1.5 py-2 text-left transition-all cursor-pointer",
                              isNavActive
                                ? "bg-white/[0.09] text-white/90 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]"
                                : "text-white/42 hover:bg-white/[0.05] hover:text-white/72",
                            )}
                          >
                            <span className={cn(
                              "flex size-7 shrink-0 items-center justify-center rounded-lg border transition-colors",
                              isNavActive ? item.iconWrap : "bg-white/[0.04] border-white/[0.06] group-hover:bg-white/[0.07]",
                            )}>
                              <Icon className={cn(
                                "size-3.5",
                                isNavActive ? item.iconColor : "text-white/38 group-hover:text-white/58",
                              )} aria-hidden />
                            </span>
                            <span className="text-[0.8125rem] font-medium flex-1">{item.label}</span>
                            {badge > 0 && (
                              <span className="ml-auto inline-flex size-4 items-center justify-center rounded-full bg-primary text-[0.55rem] font-bold text-primary-foreground">
                                {badge}
                              </span>
                            )}
                          </button>
                        );
                      })}

                      <div className="my-1 border-t border-white/[0.06]" />
                      <button
                        type="button"
                        onClick={() => goToWorkspaceNav("workspace-settings", agent)}
                        className={cn(
                          "group flex w-full items-center gap-2 rounded-lg px-1.5 py-2 text-left transition-all cursor-pointer",
                          activeNav === "workspace-settings" && viewWorkspaceId === agent.id
                            ? "bg-white/[0.09] text-white/90 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]"
                            : "text-white/42 hover:bg-white/[0.05] hover:text-white/72",
                        )}
                      >
                        <span className={cn(
                          "flex size-7 shrink-0 items-center justify-center rounded-lg border transition-colors",
                          activeNav === "workspace-settings" && viewWorkspaceId === agent.id
                            ? "bg-slate-500/20 border-slate-500/25"
                            : "bg-white/[0.04] border-white/[0.06] group-hover:bg-white/[0.07]",
                        )}>
                          <Pencil className={cn(
                            "size-3.5",
                            activeNav === "workspace-settings" && viewWorkspaceId === agent.id
                              ? "text-slate-300"
                              : "text-white/38 group-hover:text-white/58",
                          )} aria-hidden />
                        </span>
                        <span className="text-[0.8125rem] font-medium flex-1">Workspace</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          </div>

          {settingsVisible && (
            <div className={cn(
              "grid ease-in-out",
              viewTransition,
              settingsNavExpanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
            )}>
              <div className="overflow-hidden min-h-0">
                <SettingsSidebarNav
                  section={settingsSection}
                  onSectionChange={handleSettingsSectionChange}
                  onOpenInsightsDashboard={openInsightsDashboard}
                  activeInsightsDashboard={analyticsView ?? null}
                />
              </div>
            </div>
          )}
        </div>

        {/* Settings — bottom anchor (toggle) */}
        <div className="px-3 pb-4 pt-2 border-t border-white/[0.06] shrink-0">
          <button
            type="button"
            onClick={toggleSettings}
            title={activeNav === "settings" || onAnalytics ? "Close settings" : "Open settings"}
            aria-expanded={activeNav === "settings" || onAnalytics}
            className={cn(
              "w-full flex items-center gap-2.5 rounded-xl px-3 py-2 text-left cursor-pointer",
              viewTransition,
              activeNav === "settings" || onAnalytics
                ? "bg-white/8"
                : "hover:bg-white/5",
            )}
          >
            <Settings className={cn(
              "size-4 shrink-0",
              viewTransition,
              activeNav === "settings" || onAnalytics ? "text-white/70" : "text-white/30",
            )} aria-hidden />
            <span className={cn(
              "text-sm font-medium flex-1",
              viewTransition,
              activeNav === "settings" || onAnalytics ? "text-white/80" : "text-white/45",
            )}>Settings</span>
            <ChevronDown className={cn(
              "size-3.5 shrink-0 ease-in-out",
              viewTransition,
              settingsNavExpanded ? "rotate-180 text-white/35" : "rotate-0 text-white/20",
            )} aria-hidden />
          </button>
        </div>
      </aside>

      {/* ── Center ───────────────────────────────────────────────────────── */}
      <main className="flex flex-1 min-w-0 flex-col">

        {/* Slim header bar */}
        <div className="flex items-center gap-3 border-b border-white/6 px-5 py-3 shrink-0">
          <div className="relative flex flex-1 items-center gap-2.5 min-w-0 min-h-[1.75rem]">
            <div className={cn(
              "flex items-center gap-2.5 min-w-0 w-full ease-in-out",
              viewTransition,
              workContentShown
                ? "opacity-100 translate-y-0"
                : "opacity-0 translate-y-1 pointer-events-none absolute inset-0",
            )}>
            {isWorkspaceNav(headerWorkNav) ? (
              <>
                <WorkspaceBreadcrumb
                  agent={viewWorkspace}
                  sectionLabel={navTitle(headerWorkNav)}
                  pickerId="header"
                  open={openWorkspacePickerId === "header"}
                  onToggle={() => toggleWorkspacePicker("header")}
                  workspaces={workspaces}
                  onSelectAgent={selectViewWorkspace}
                />
                {headerWorkNav === "thread" && isStreaming && (
                  <button
                    type="button"
                    onClick={cancelStream}
                    className="flex items-center gap-1.5 text-xs text-red-400/80 hover:text-red-400 transition-colors shrink-0"
                    aria-label="Stop response"
                  >
                    <Square className="size-3 fill-current" aria-hidden />
                    Stop
                  </button>
                )}
                {headerWorkNav === "thread" && totalRedactions > 0 && (
                  <Badge variant="secondary" className="gap-1 h-5 text-[0.65rem] bg-white/5 text-white/45 border-white/8 shrink-0">
                    <ShieldCheck className="size-2.5" aria-hidden />
                    {totalRedactions} redacted
                  </Badge>
                )}
              </>
            ) : (
              <h1 className="text-sm font-semibold text-white/70">{navTitle(headerWorkNav)}</h1>
            )}
            </div>
            <div className={cn(
              "flex items-center gap-1.5 min-w-0 text-sm ease-in-out",
              viewTransition,
              settingsContentShown
                ? "opacity-100 translate-y-0"
                : "opacity-0 translate-y-1 pointer-events-none absolute inset-0",
            )}>
              <span className="font-semibold text-white/85 shrink-0">Settings</span>
              {settingsSection !== "overview" && (
                <>
                  <ChevronRight className="size-3.5 text-white/25 shrink-0" aria-hidden />
                  <span className="text-white/45 truncate">{SETTINGS_SECTION_LABELS[settingsSection]}</span>
                </>
              )}
            </div>
          </div>

          {/* Mobile intelligence sheet — hidden on full analytics views */}
          {!isAnalytics && (
          <Sheet>
            <SheetTrigger
              className={cn(
                buttonVariants({ variant: "outline", size: "sm", className: "h-7 text-xs gap-1.5 lg:hidden shrink-0 border-white/10 bg-white/4" }),
              )}
            >
              <Sparkles className="size-3.5" aria-hidden />
              Intel
            </SheetTrigger>
            <SheetContent side="right" className="w-full sm:max-w-sm flex flex-col p-0 bg-sidebar border-white/8">
              <SheetHeader className="px-5 pt-5 pb-4 border-b border-white/6 shrink-0">
                <SheetTitle className="text-base font-bold tracking-tight">Insights</SheetTitle>
              </SheetHeader>
              <div className="flex-1 min-h-0 overflow-hidden px-4 py-4">
                {IntelligencePanel}
              </div>
            </SheetContent>
          </Sheet>
          )}
        </div>

        {/* Content */}
        <div className="flex flex-1 min-h-0 relative overflow-hidden">
          <div
            className={cn(
              "absolute inset-0 flex flex-col min-h-0 ease-in-out",
              viewTransition,
              workContentShown
                ? "opacity-100 translate-y-0 scale-100"
                : "opacity-0 translate-y-1 scale-[0.992] pointer-events-none",
            )}
            aria-hidden={!workContentShown}
          >
        {analyticsView ? (
          <div className="flex-1 min-h-0 overflow-hidden">
            {analyticsView === "security" && (
              <SecurityAnalyticsView
                workspaces={workspaces.map(w => ({ id: w.id, name: w.name }))}
              />
            )}
            {analyticsView === "usage" && (
              <UsageAnalyticsView
                workspaces={workspaces.map(w => ({ id: w.id, name: w.name }))}
              />
            )}
            {analyticsView === "cost" && (
              <CostAnalyticsView
                workspaces={workspaces.map(w => ({ id: w.id, name: w.name }))}
              />
            )}
          </div>
        ) : workNav === "bookmarks" ? (
          /* Bookmarks view */
          <div className="flex-1 overflow-y-auto px-5 py-6">
            <div className="max-w-2xl mx-auto flex flex-col gap-5">
              <WorkspaceSectionHeader
                workspaces={workspaces}
                viewWorkspaceId={viewWorkspaceId}
                sectionLabel="Saved"
                pickerId="bookmarks"
                open={openWorkspacePickerId === "bookmarks"}
                onToggle={() => toggleWorkspacePicker("bookmarks")}
                onSelect={selectViewWorkspace}
                subtitle={
                  viewBookmarks.length > 0 ? (
                    <p className="text-[0.7rem] text-white/30 mt-0.5 px-1.5">
                      {viewBookmarks.length} pinned {viewBookmarks.length === 1 ? "message" : "messages"}
                      {viewBookmarks.some(b => !b.read) && (
                        <span className="text-indigo-400/70"> · {viewBookmarks.filter(b => !b.read).length} unread</span>
                      )}
                    </p>
                  ) : undefined
                }
                actions={
                  viewBookmarks.some(b => !b.read) ? (
                    <button
                      type="button"
                      onClick={() => {
                        const updated = viewBookmarks.map(b => ({ ...b, read: true }));
                        setViewBookmarks(updated);
                        if (viewWorkspaceId) {
                          localStorage.setItem(`sm_bm_${viewWorkspaceId}`, JSON.stringify(updated));
                        }
                        if (viewWorkspaceId === activeWorkspaceId) setBookmarks(updated);
                      }}
                      className="text-[0.7rem] text-indigo-400/60 hover:text-indigo-400 transition-colors flex items-center gap-1 shrink-0"
                    >
                      <Check className="size-3" aria-hidden />
                      Mark all read
                    </button>
                  ) : undefined
                }
              />

              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                <p className="text-sm text-white/50 leading-relaxed">
                  Saved conclusions and pinned answers from investigations in{" "}
                  <span className="text-white/70 font-medium">{viewWorkspace?.name ?? "this workspace"}</span>.
                  {" "}Open one to jump back to that moment in the thread.
                </p>
              </div>

              {viewBookmarks.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 px-5 py-10 text-center space-y-3">
                  <Bookmark className="size-8 text-amber-400/25 mx-auto" aria-hidden />
                  <p className="text-sm font-medium text-white/50">No saved conclusions yet</p>
                  <p className="text-xs text-white/30 leading-relaxed max-w-sm mx-auto">
                    Open Chat, hover any answer, and tap the bookmark icon to save it here.
                  </p>
                </div>
              ) : (
                groupedViewBookmarks.map(group => (
                  <section key={group.dayKey}>
                    <h3 className="sticky top-0 z-[1] -mx-1 mb-2.5 px-1 py-1.5 text-[0.65rem] uppercase tracking-[0.22em] text-white/30 font-semibold backdrop-blur-sm bg-[#0d0d11]/80">
                      {group.label}
                      <span className="ml-2 normal-case tracking-normal text-white/20 font-normal">
                        · {group.items.length} saved
                      </span>
                    </h3>
                    <div className="flex flex-col gap-2.5">
                      {group.items.map(bm => (
                        <BookmarkCard
                          key={bm.messageId}
                          bookmark={bm}
                          workspaceEmoji={viewWorkspace?.emoji ?? "🤖"}
                          onOpen={() => scrollToMessage(bm.messageId)}
                          onRemove={() => viewWorkspaceId && removeBookmark(viewWorkspaceId, bm.messageId)}
                        />
                      ))}
                    </div>
                  </section>
                ))
              )}
            </div>
          </div>

        ) : workNav === "memory" ? (
          /* ── Memory dashboard ── */
          <div className="flex-1 overflow-y-auto px-5 py-6">
            <div className="max-w-4xl mx-auto flex flex-col gap-6">
              <WorkspaceSectionHeader
                workspaces={workspaces}
                viewWorkspaceId={viewWorkspaceId}
                sectionLabel="Memory"
                pickerId="memory"
                open={openWorkspacePickerId === "memory"}
                onToggle={() => toggleWorkspacePicker("memory")}
                onSelect={selectViewWorkspace}
                subtitle={
                  !memoryLoading ? (
                    <p className="text-[0.7rem] text-white/30 mt-0.5 px-1.5">
                      {viewWorkspaceId === activeWorkspaceId
                        ? "Live profile for this workspace"
                        : `Viewing ${viewWorkspaceName}'s learned profile`}
                    </p>
                  ) : (
                    <p className="text-[0.7rem] text-white/30 mt-0.5 px-1.5 animate-pulse">Syncing…</p>
                  )
                }
              />
              <MemoryDashboard
                workspaceName={viewWorkspaceName}
                workspaceFacts={workspaceFacts}
                userFacts={userFacts}
                sessionSummaries={allSessionSummaries}
                liveSessionSummary={viewWorkspaceId === activeWorkspaceId ? sessionSummary : ""}
                liveFacts={viewWorkspaceId === activeWorkspaceId ? extractedFacts : {}}
                memoryLoading={memoryLoading}
                memoryStats={memoryStats}
                isActiveWorkspace={viewWorkspaceId === activeWorkspaceId}
                messageCount={messages.length}
                summarizedCount={summarizedCount}
              />
            </div>
          </div>

        ) : workNav === "security-dashboard" ? (
          /* ── Security dashboard (full center view) ── */
          <div className="flex-1 overflow-y-auto px-5 py-6">
            <div className="max-w-3xl mx-auto flex flex-col gap-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <button
                    type="button"
                    onClick={exitSecurityDashboard}
                    className="flex items-center gap-1.5 text-sm text-white/45 hover:text-white/70 transition-colors mb-3 cursor-pointer"
                  >
                    <ChevronLeft className="size-4" aria-hidden />
                    {securityBackLabel}
                  </button>
                  <h2 className="text-lg font-bold text-white/90 tracking-tight">Security</h2>
                  <p className="text-sm text-white/40 mt-1 max-w-lg">
                    Detection history for this account. False positives are handled with sensitivity
                    tiers and safe terms — there is no way to restore a redacted value.
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-2xl font-bold tabular-nums text-white/90">{totalPiiFiltered}</p>
                  <p className="text-[0.65rem] text-white/35">active in range</p>
                </div>
              </div>

              <div className="rounded-2xl bg-white/[0.03] border border-white/8 px-4 py-3">
                <p className="text-[0.58rem] uppercase tracking-wider text-white/30 font-semibold mb-2">
                  Scanned at {piiSensitivity} sensitivity
                </p>
                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                  {activePiiCategories.map(label => {
                    const CatIcon = PII_SCAN_ICONS[label] ?? Shield;
                    return (
                      <li key={label} className="flex items-center gap-2 text-[0.65rem] text-white/50">
                        <CatIcon className="size-3 shrink-0 text-white/35" aria-hidden />
                        {label}
                      </li>
                    );
                  })}
                </ul>
                {inactivePiiCategories.length > 0 && (
                  <>
                    <p className="text-[0.58rem] uppercase tracking-wider text-white/25 font-semibold mt-3 mb-2">
                      Not scanned at this level
                    </p>
                    <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                      {inactivePiiCategories.map(label => {
                        const CatIcon = PII_SCAN_ICONS[label] ?? Shield;
                        return (
                          <li key={label} className="flex items-center gap-2 text-[0.65rem] text-white/28">
                            <CatIcon className="size-3 shrink-0 text-white/20" aria-hidden />
                            <span className="line-through decoration-white/20">{label}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )}
              </div>

              <WorkspaceStatsFilter
                workspaces={workspaces}
                value={piiStatsWorkspaceId}
                onChange={setPiiStatsWorkspaceId}
              />

              <div className="flex flex-wrap items-center gap-3">
                <StatsRangePicker value={piiStatsRange} onChange={setPiiStatsRange} />
                <label className="flex items-center gap-2 ml-auto cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showDismissedPii}
                    onChange={e => setShowDismissedPii(e.target.checked)}
                    className="accent-indigo-500"
                  />
                  <span className="text-[0.65rem] text-white/40">Show dismissed</span>
                </label>
              </div>

              {piiCategoryCounts.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {piiCategoryCounts.map(([label, count]) => (
                    <span
                      key={label}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-white/[0.04] border border-white/8 px-2.5 py-1 text-[0.68rem] text-white/55"
                    >
                      {label}
                      <span className="font-mono font-semibold text-white/80 tabular-nums">{count}</span>
                    </span>
                  ))}
                </div>
              )}

              {piiGroupedByDate.length === 0 ? (
                <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-6 py-14 text-center">
                  <ShieldCheck className="size-8 text-white/15 mx-auto mb-3" aria-hidden />
                  <p className="text-sm text-white/40">No PII detected for this time range.</p>
                </div>
              ) : (
                piiGroupedByDate.map(({ dayKey, label, items }) => (
                  <section key={dayKey}>
                    <div className="flex items-center gap-3 mb-3">
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-white/45 shrink-0">{label}</h3>
                      <div className="flex-1 h-px bg-white/[0.06]" />
                      <span className="text-[0.65rem] text-white/25 tabular-nums">{items.length} event{items.length !== 1 ? "s" : ""}</span>
                    </div>
                    <ul className="space-y-2 border-l-2 border-white/[0.08] ml-2 pl-4">
                      {items.map(({ entry, rec }) => {
                        const isDismissed = dismissedPiiIds.has(rec.id);
                        const ag = workspaceDisplay(workspaces, entry.workspaceId);
                        return (
                          <li
                            key={rec.id}
                            id={`pii-record-${rec.id}`}
                            className={cn(
                              "rounded-xl border px-4 py-3 space-y-2 scroll-mt-24 transition-shadow duration-500",
                              highlightedPiiRecordId === rec.id && "ring-2 ring-indigo-500/60 shadow-lg shadow-indigo-500/10",
                              isDismissed
                                ? "bg-white/[0.02] border-white/[0.06] opacity-60"
                                : "bg-white/[0.04] border-white/[0.08]",
                            )}
                          >
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="inline-flex items-center rounded-full bg-red-400/10 border border-red-400/20 px-2 py-0.5 text-[0.62rem] text-red-400/80 font-medium uppercase tracking-wider">
                                  {categoryLabel(rec.category)}
                                </span>
                                {isDismissed && (
                                  <span className="text-[0.6rem] text-white/30">Dismissed</span>
                                )}
                              </div>
                              <div className="flex flex-col items-end gap-0.5 shrink-0">
                                <span className="inline-flex items-center gap-1 text-[0.62rem] text-white/40">
                                  {ag.emoji && <span aria-hidden>{ag.emoji}</span>}
                                  {ag.name}
                                </span>
                                <span className="text-[0.65rem] text-white/30 tabular-nums">
                                  {formatMsgTime(entry.at)}
                                  {entry.source === "document"
                                    ? ` · Document${entry.documentName ? `: ${entry.documentName}` : ""}`
                                    : ` · Turn ${entry.turn}`}
                                </span>
                              </div>
                            </div>
                            <p className="text-[0.75rem] text-white/50 font-mono leading-relaxed break-all">{rec.context}</p>
                            {(
                              <div className="flex flex-wrap items-center gap-2 pt-0.5">
                                {!isDismissed && (
                                  <button
                                    type="button"
                                    onClick={() => dismissPiiRecord(rec.id)}
                                    className="text-[0.65rem] text-white/35 hover:text-white/60 transition-colors cursor-pointer"
                                  >
                                    Dismiss
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => deletePiiRecord(rec.id)}
                                  className="text-[0.65rem] text-red-400/50 hover:text-red-400/80 transition-colors cursor-pointer inline-flex items-center gap-1"
                                >
                                  <Trash2 className="size-3" aria-hidden />
                                  Delete
                                </button>
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ))
              )}

              <div className="rounded-xl border border-white/8 bg-white/[0.02] px-4 py-3 text-[0.62rem] text-white/35 leading-relaxed">
                <p className="text-white/50 font-medium mb-1">How detection works</p>
                Client-side patterns scan every message before send. Raw values are never stored.
                Matches become placeholders like <code className="font-mono text-white/45">[phone redacted]</code>.
                Reduce false positives with sensitivity tiers and safe terms in App settings.
                API keys and private-key blocks are hard-blocked (always scanned, never safe-listed).
                Answers cite retrieved Knowledge and memory as numbered sources when available.
              </div>
            </div>
          </div>

        ) : workNav === "workspace-settings" ? (
          /* ── Workspace settings ── */
          <div className="flex-1 overflow-y-auto px-5 py-6">
            <div className="max-w-4xl mx-auto flex flex-col gap-5">
              <WorkspaceSectionHeader
                workspaces={workspaces}
                viewWorkspaceId={viewWorkspaceId}
                sectionLabel="Workspace"
                pickerId="workspace-settings"
                open={openWorkspacePickerId === "workspace-settings"}
                onToggle={() => toggleWorkspacePicker("workspace-settings")}
                onSelect={selectViewWorkspace}
                subtitle={
                  viewWorkspace ? (
                    <p className="text-[0.7rem] text-white/30 mt-0.5 px-1.5">
                      Icon, color, description, and operational context for this workspace
                    </p>
                  ) : undefined
                }
              />

              {viewWorkspace && (
                <WorkspaceEditor
                  key={viewWorkspace.id}
                  workspace={viewWorkspace}
                  onSave={async patch => { await saveWorkspace(viewWorkspace.id, patch); }}
                  onDelete={
                    !viewWorkspace.isDefault && workspaces.length > 1
                      ? () => {
                          setDeleteWithBackup(true);
                          setDeleteConfirmWorkspace(viewWorkspace);
                        }
                      : undefined
                  }
                />
              )}
            </div>
          </div>

        ) : workNav === "documents" ? (
          /* ── Document Library view ── */
          <div
            className="flex-1 overflow-y-auto px-5 py-6"
            onDragEnter={!selectedDoc ? handleDocDragEnter : undefined}
            onDragLeave={!selectedDoc ? handleDocDragLeave : undefined}
            onDragOver={!selectedDoc ? handleDocDragOver : undefined}
            onDrop={!selectedDoc ? handleDocDrop : undefined}
          >

            <input
              ref={docFileRef}
              type="file"
              multiple
              className="hidden"
              accept={DOC_ACCEPT_ATTR}
              onChange={e => {
                const files = e.target.files;
                if (files?.length) void handleDocumentFiles(files);
              }}
            />

            {selectedDoc ? (
              /* ── Detail view ── */
              <div className="max-w-2xl mx-auto flex flex-col gap-5">

                {/* Header */}
                <div className="flex items-center justify-between gap-3">
                  <button
                    onClick={() => setSelectedDoc(null)}
                    className="flex items-center gap-1.5 text-sm text-white/45 hover:text-white/70 transition-colors"
                  >
                    <ChevronLeft className="size-4" aria-hidden />
                    Knowledge
                  </button>
                  <button
                    onClick={() => deleteDocument(selectedDoc.id)}
                    className="flex items-center gap-1.5 text-[0.72rem] text-red-400/60 hover:text-red-400 transition-colors px-2 py-1 rounded-lg hover:bg-red-500/10"
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                    Delete
                  </button>
                </div>

                {/* Document header card */}
                <div className="rounded-2xl bg-white/[0.04] border border-white/[0.07] p-5">
                  <div className="flex items-start gap-3">
                    <span className={cn(
                      "shrink-0 rounded-lg border px-2.5 py-1 text-[0.65rem] font-bold tracking-wider font-mono",
                      docTypeInfo(selectedDoc.mimeType).cls,
                    )}>
                      {docTypeInfo(selectedDoc.mimeType).label}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-base font-semibold text-white/90 break-all leading-snug">
                        {selectedDoc.name}
                      </p>
                      {selectedDoc.description && (
                        <p className="mt-0.5 text-sm text-white/45">{selectedDoc.description}</p>
                      )}
                      <p className="mt-2 text-[0.72rem] text-white/35 leading-relaxed">
                        Only sanitized text is stored and indexed. Chunks are retrieved automatically during investigations when your questions match.
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-3 text-[0.72rem] text-white/40">
                    <span>{fmtBytes(selectedDoc.sizeBytes)}</span>
                    <span>·</span>
                    <span>{selectedDoc.chunkCount} chunks indexed</span>
                    <span>·</span>
                    <span>Uploaded {timeSince(selectedDoc.createdAt)}</span>
                    <span>·</span>
                    <span className={cn(
                      "flex items-center gap-1",
                      selectedDoc.status === "ready" && selectedDoc.chunkCount > 0 ? "text-emerald-400" :
                      selectedDoc.status === "ready"      ? "text-amber-400" :
                      selectedDoc.status === "processing" ? "text-yellow-400" :
                                                            "text-red-400",
                    )}>
                      <span className={cn(
                        "size-1.5 rounded-full inline-block",
                        selectedDoc.status === "ready" && selectedDoc.chunkCount > 0 ? "bg-emerald-400" :
                        selectedDoc.status === "ready"      ? "bg-amber-400" :
                        selectedDoc.status === "processing" ? "bg-yellow-400 animate-pulse" :
                                                              "bg-red-400",
                      )} />
                      {selectedDoc.status === "ready" && selectedDoc.chunkCount > 0 ? "Indexed" :
                       selectedDoc.status === "ready" ? "Stored · start Ollama to index" :
                       selectedDoc.status === "processing" ? "Embedding…" :
                       "Failed"}
                    </span>
                  </div>
                </div>

                {(selectedDoc.redactionCount ?? 0) > 0 && (
                  <div className="rounded-xl bg-amber-500/[0.07] border border-amber-500/20 px-4 py-3 space-y-2">
                    <p className="text-sm font-medium text-amber-200/90 flex items-center gap-2">
                      <Shield className="size-4 shrink-0" aria-hidden />
                      {selectedDoc.redactionCount} PII {selectedDoc.redactionCount === 1 ? "item" : "items"} scrubbed at upload
                    </p>
                    <p className="text-[0.72rem] text-white/40 leading-relaxed">
                      Raw values were replaced with typed placeholders before this file was saved or embedded.
                      Only the sanitized text below is stored and sent to the model.
                    </p>
                    {selectedDoc.scrubEvents && selectedDoc.scrubEvents.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-0.5">
                        {selectedDoc.scrubEvents.map(ev => (
                          <span
                            key={ev.category}
                            className="text-[0.62rem] rounded-md border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-amber-200/70"
                          >
                            {categoryLabel(ev.category)} ×{ev.count}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Content preview */}
                <div>
                  <p className="text-[0.65rem] uppercase tracking-[0.25em] text-white/25 mb-2">
                    Extracted content
                  </p>
                  <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] px-4 py-3 max-h-52 overflow-y-auto">
                    <p className="text-[0.8rem] text-white/55 leading-relaxed whitespace-pre-wrap font-mono">
                      {selectedDoc.content.slice(0, 1500)}
                      {selectedDoc.content.length > 1500 && (
                        <span className="text-white/25"> … [{(selectedDoc.content.length - 1500).toLocaleString()} more chars]</span>
                      )}
                    </p>
                  </div>
                </div>

                {/* Chunk list */}
                {selectedDoc.fragments.length > 0 && (
                  <div>
                    <p className="text-[0.65rem] uppercase tracking-[0.25em] text-white/25 mb-2">
                      Embedded chunks ({selectedDoc.fragments.length})
                    </p>
                    <div className="flex flex-col gap-1.5">
                      {selectedDoc.fragments.map((frag, i) => (
                        <div
                          key={frag.id}
                          className="rounded-xl bg-white/[0.03] border border-white/[0.05] px-4 py-2.5"
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[0.6rem] font-mono text-white/20">#{i + 1}</span>
                            <span className="text-[0.6rem] text-white/20">{timeSince(frag.createdAt)}</span>
                          </div>
                          <p className="text-[0.78rem] text-white/50 leading-relaxed line-clamp-2">
                            {frag.content.slice(0, 160)}
                            {frag.content.length > 160 && <span className="text-white/25">…</span>}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

            ) : (
              /* ── Library grid ── */
              <div className="max-w-2xl mx-auto flex flex-col gap-5 relative">

                {docDragOver && (
                  <div className="absolute inset-0 z-20 rounded-2xl border-2 border-dashed border-indigo-400/50 bg-indigo-500/10 backdrop-blur-[2px] flex items-center justify-center pointer-events-none">
                    <div className="text-center px-6">
                      <Upload className="size-10 text-indigo-300 mx-auto mb-3" aria-hidden />
                      <p className="text-base font-semibold text-indigo-100">Drop to upload</p>
                      <p className="text-sm text-indigo-200/60 mt-1">
                        Files are added to {viewWorkspace?.name ?? "this workspace"}&apos;s library
                      </p>
                    </div>
                  </div>
                )}

                <WorkspaceSectionHeader
                  workspaces={workspaces}
                  viewWorkspaceId={viewWorkspaceId}
                  sectionLabel="Documents"
                  pickerId="documents"
                  open={openWorkspacePickerId === "documents"}
                  onToggle={() => toggleWorkspacePicker("documents")}
                  onSelect={selectViewWorkspace}
                  subtitle={
                    documents.length > 0 ? (
                      <p className="text-[0.7rem] text-white/30 mt-0.5 px-1.5">
                        {documents.length} {documents.length === 1 ? "document" : "documents"} ·{" "}
                        {documents.filter(d => d.status === "ready").reduce((s, d) => s + d.chunkCount, 0)} chunks indexed
                        {documents.some(d => d.status === "processing") && (
                          <span className="text-yellow-400/70"> · processing</span>
                        )}
                      </p>
                    ) : undefined
                  }
                  actions={
                    <button
                      type="button"
                      onClick={browseDocuments}
                      disabled={docUploading}
                      className={cn(
                        "flex items-center gap-1.5 rounded-xl px-3 py-1.5 shrink-0",
                        "text-[0.75rem] font-medium transition-all",
                        "bg-indigo-500/15 text-indigo-300 border border-indigo-500/20",
                        "hover:bg-indigo-500/25 hover:border-indigo-500/35",
                        "disabled:opacity-40 disabled:cursor-not-allowed",
                      )}
                    >
                      <Upload className="size-3.5" aria-hidden />
                      {docUploading ? "Uploading…" : "Upload file"}
                    </button>
                  }
                />

                <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3.5 space-y-2.5">
                  <p className="text-sm text-white/50 leading-relaxed">
                    Build a reference library for{" "}
                    <span className="text-white/75 font-medium">{viewWorkspace?.name ?? "this workspace"}</span>.
                    Uploaded files are stored in your database, scrubbed for PII, split into searchable chunks, and
                    automatically retrieved during investigations when your questions match.
                  </p>
                  <ol className="text-[0.72rem] text-white/35 space-y-1 list-decimal list-inside leading-relaxed">
                    <li>Text is extracted from your file (PDFs included)</li>
                    <li>PII is redacted using the same patterns as Chat — only sanitized text is stored or embedded</li>
                    <li>Content is chunked and embedded with vector search (pgvector)</li>
                    <li>Relevant passages surface in investigations — scoped to this workspace only</li>
                  </ol>
                </div>

                {docError && (
                  <div className="flex items-center justify-between gap-3 rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-2.5">
                    <p className="text-[0.78rem] text-red-300">{docError}</p>
                    <button
                      type="button"
                      onClick={() => setDocError(null)}
                      className="text-red-400/60 hover:text-red-400 text-sm shrink-0"
                    >
                      ✕
                    </button>
                  </div>
                )}

                {docLoading && (
                  <div className="flex items-center gap-2 text-sm text-white/30 animate-pulse">
                    <Loader2 className="size-4 animate-spin shrink-0" aria-hidden />
                    Loading documents…
                  </div>
                )}

                {!docLoading && (
                  <DocumentDropZone
                    active={docDragOver}
                    uploading={docUploading}
                    onBrowse={browseDocuments}
                    compact={documents.length > 0}
                  />
                )}

                {docUploading && (
                  <div className={cn(
                    "grid gap-3",
                    documents.length > 0 ? "grid-cols-2" : "grid-cols-1 max-w-sm mx-auto w-full",
                  )}>
                    <div className="rounded-2xl bg-white/[0.04] border border-indigo-500/20 p-4 animate-pulse flex flex-col gap-2">
                      <div className="h-4 w-12 rounded bg-white/10" />
                      <div className="h-3 w-3/4 rounded bg-white/8 mt-1" />
                      <div className="h-3 w-1/2 rounded bg-white/6" />
                      {documents.length === 0 && (
                        <>
                          <div className="h-8 w-full rounded bg-white/4 mt-2" />
                          <div className="h-3 w-1/3 rounded bg-white/5 mt-1" />
                        </>
                      )}
                    </div>
                  </div>
                )}

                {!docLoading && !docUploading && documents.length === 0 && (
                  <div className="text-center pb-4">
                    <p className="text-xs text-white/25 leading-relaxed max-w-md mx-auto">
                      No documents yet — drop a file above or use Upload file. PII in uploads is scrubbed before
                      storage and embedding, same as investigation messages.
                    </p>
                  </div>
                )}

                {documents.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {documents.map(doc => (
                      <DocumentCard
                        key={doc.id}
                        doc={doc}
                        onOpen={() => openDocDetail(doc.id)}
                        onDelete={() => deleteDocument(doc.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

        ) : (
          /* Thread view */
          <div className="flex flex-1 min-h-0 flex-col">
            {/* Scrollable thread — ChatGPT-style */}
            <div
              ref={threadRef}
              className="flex-1 overflow-y-auto relative"
            >
              {/* Floating date pill — appears when scrolled into historical messages */}
              {floatingDate && (
                <div className="sticky top-3 z-10 flex justify-center pointer-events-none">
                  <span className="rounded-full bg-[#1a1a2e]/90 border border-white/10 text-[0.65rem] text-white/50 px-3 py-1 backdrop-blur-sm shadow-lg">
                    {floatingDate}
                  </span>
                </div>
              )}
              <div className="max-w-4xl mx-auto px-5 py-8 flex flex-col gap-6">
                {sessionLoading && messages.length === 0 ? (
                  <div className="flex items-center gap-2 text-white/30 text-sm">
                    <Loader2 className="size-4 animate-spin shrink-0" aria-hidden />
                    <span>Loading conversation…</span>
                  </div>
                ) : (
                  <>
                    {sessionLoading && (
                      <div className="flex items-center gap-2 text-white/25 text-xs -mb-3">
                        <Loader2 className="size-3 animate-spin shrink-0" aria-hidden />
                        <span>Syncing…</span>
                      </div>
                    )}
                    {messages.map((msg, i) => {
                    const prevDate = i > 0 && messages[i - 1].createdAt
                      ? new Date(messages[i - 1].createdAt!).toDateString()
                      : null;
                    const thisDate = msg.createdAt ? new Date(msg.createdAt).toDateString() : null;
                    const showDivider = thisDate && thisDate !== prevDate;
                    const dividerLabel = showDivider ? formatDateDivider(msg.createdAt!) : null;
                    return (
                      <div key={msg.id}>
                        {showDivider && (
                          <div
                            data-date-divider={dividerLabel}
                            className="flex items-center gap-3 mb-2 -mt-2"
                          >
                            <div className="flex-1 h-px bg-white/[0.06]" />
                            <span suppressHydrationWarning className="text-[0.65rem] text-white/30 px-1 shrink-0 select-none">
                              {dividerLabel}
                            </span>
                            <div className="flex-1 h-px bg-white/[0.06]" />
                          </div>
                        )}
                        <MessageBubble
                          message={msg}
                          workspaceName={workspaceName}
                          workspaceEmoji={activeWorkspace?.emoji}
                          workspaceColor={activeWorkspace?.color}
                          onBookmark={toggleBookmark}
                          highlighted={highlightedMessageId === msg.id}
                        />
                      </div>
                    );
                  })}
                  </>
                )}
                <div ref={bottomRef} />
              </div>
            </div>

            {/* Composer — sticky at bottom, centered */}
            <div
              className="shrink-0 px-5 pt-3 pb-9 border-t border-white/5"
              onDragEnter={handleComposerDragEnter}
              onDragLeave={handleComposerDragLeave}
              onDragOver={handleComposerDragOver}
              onDrop={handleComposerDrop}
            >
              <form
                onSubmit={e => { e.preventDefault(); handleSend(); setAttachments([]); }}
                className="max-w-4xl mx-auto relative"
              >
                {sessionSaveError && (
                  <div className="mb-2 flex items-center justify-between gap-3 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-200/90">
                    <span>{sessionSaveError}</span>
                    <button
                      type="button"
                      onClick={() => setSessionSaveError(null)}
                      className="shrink-0 text-amber-200/50 hover:text-amber-200"
                      aria-label="Dismiss"
                    >
                      ✕
                    </button>
                  </div>
                )}

                {knowledgeIngestNote && (
                  <div className="mb-2 flex items-center justify-between gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200/85">
                    <span>{knowledgeIngestNote}</span>
                    <button
                      type="button"
                      onClick={() => setKnowledgeIngestNote(null)}
                      className="shrink-0 text-emerald-200/50 hover:text-emerald-200"
                      aria-label="Dismiss"
                    >
                      ✕
                    </button>
                  </div>
                )}

                {/* Attachment preview strip */}
                {attachments.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2 px-1">
                    {attachments.map(f => (
                      <div key={f.name + f.size} className="flex items-center gap-1.5 rounded-lg bg-white/6 border border-white/8 px-2.5 py-1 text-xs text-white/60">
                        <span className="truncate max-w-[140px]">{f.name}</span>
                        <span className="text-white/25 text-[0.6rem]">
                          {f.type.startsWith("image/") ? "vision + knowledge" : "→ knowledge"}
                        </span>
                        <button type="button" onClick={() => removeAttachment(f.name)} className="text-white/30 hover:text-white/60">✕</button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Emoji picker popover */}
                {showEmoji && (
                  <div ref={emojiPickerRef} className="absolute bottom-24 left-1/2 -translate-x-1/2 z-50 shadow-2xl rounded-2xl overflow-hidden">
                    <EmojiPicker
                      theme={Theme.DARK}
                      onEmojiClick={onEmojiClick}
                      lazyLoadEmojis
                      searchPlaceholder="Search emoji…"
                      height={380}
                      width={320}
                    />
                  </div>
                )}

                <div className={cn(
                  "rounded-2xl border transition-all shadow-xl shadow-black/20 overflow-hidden relative",
                  composerDragOver
                    ? "bg-indigo-500/[0.08] border-indigo-400/45 ring-2 ring-indigo-400/20"
                    : listening
                      ? "bg-white/[0.06] border-indigo-400/25"
                      : "bg-white/[0.08] border-white/[0.11] focus-within:border-white/20 focus-within:bg-white/[0.10]",
                )}>
                  {composerDragOver && (
                    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1.5 bg-[#0d0d12]/90 pointer-events-none">
                      <Upload className="size-6 text-indigo-300/80" aria-hidden />
                      <p className="text-sm font-medium text-indigo-100">Drop to attach</p>
                      <p className="text-[0.65rem] text-white/40">Saved to Knowledge when you send</p>
                    </div>
                  )}
                  {/* Text input row — or voice bar when recording */}
                  {listening ? (
                    <VoiceBar
                      state={voiceState as "requesting" | "listening" | "transcribing"}
                      waveHistory={waveHistory}
                      elapsed={voiceElapsed}
                      liveText={liveText}
                      previewPending={previewPending}
                      onCancel={cancelVoice}
                      onConfirm={confirmVoice}
                    />
                  ) : (
                    <ComposerInput
                      ref={composerRef}
                      workspaceName={workspaceName}
                      sessionLoading={sessionLoading}
                      sessionReady={sessionReady}
                      isStreaming={isStreaming}
                      voiceInsert={voiceComposerInsert}
                      onVoiceInsertApplied={() => setVoiceComposerInsert(null)}
                      onSend={() => { handleSend(); setAttachments([]); }}
                      onCancelStream={cancelStream}
                      onStartVoice={startVoice}
                    />
                  )} {/* end of non-listening branch */}

                  {/* Toolbar row */}
                  <div className="flex items-center gap-1 px-3 pb-2.5 border-t border-white/5 pt-2">
                    {/* Emoji */}
                    <button
                      ref={emojiBtnRef}
                      type="button"
                      onClick={() => setShowEmoji(p => !p)}
                      title="Emoji"
                      className={cn(
                        "flex items-center justify-center size-7 rounded-lg text-base transition-colors",
                        showEmoji ? "bg-white/10 text-white/80" : "text-white/30 hover:text-white/70 hover:bg-white/6",
                      )}
                    >
                      😊
                    </button>

                    {/* Attach file */}
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      title="Attach file or image"
                      className="flex items-center justify-center size-7 rounded-lg text-white/30 hover:text-white/70 hover:bg-white/6 transition-colors"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4">
                        <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
                      </svg>
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept={COMPOSER_ACCEPT_ATTR}
                      multiple
                      className="hidden"
                      onChange={onFileChange}
                    />

                    {/* Image only shortcut */}
                    <button
                      type="button"
                      onClick={() => { if (fileInputRef.current) { fileInputRef.current.accept = "image/*"; fileInputRef.current.click(); fileInputRef.current.accept = COMPOSER_ACCEPT_ATTR; } }}
                      title="Attach image"
                      className="flex items-center justify-center size-7 rounded-lg text-white/30 hover:text-white/70 hover:bg-white/6 transition-colors"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4">
                        <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>
                      </svg>
                    </button>

                    <div className="flex-1" />
                  </div>
                </div>

                <p className="mt-2.5 text-center text-[0.65rem] leading-relaxed text-white/20 select-none px-2">
                  Drop files here or use the paperclip — attachments go to Knowledge. PII is scrubbed before storage or the model.
                </p>

              </form>
            </div>
          </div>
        )}
          </div>

          <div
            className={cn(
              "absolute inset-0 flex flex-col min-h-0 overflow-hidden ease-in-out",
              viewTransition,
              settingsContentShown
                ? "opacity-100 translate-y-0"
                : "opacity-0 translate-y-2 pointer-events-none",
            )}
            aria-hidden={!settingsContentShown}
          >
            {settingsVisible && (
              <SettingsHub
                section={settingsSection}
                onSectionChange={handleSettingsSectionChange}
                onOpenInsightsDashboard={openInsightsDashboard}
                safeTerms={safeTerms}
                onAddSafeTerm={addSafeTerm}
                onRemoveSafeTerm={removeSafeTerm}
                piiSensitivity={piiSensitivity}
                onPiiSensitivityChange={setPiiSensitivity}
                savingsStats={savingsStats}
                savingsBaselineLabel={displayModelLabel(savingsBaselineModel)}
                totalRouteCalls={totalRouteCalls}
                totalPiiActive={totalPiiFiltered}
                lastRouteLabel={lastRouteInfo
                  ? `${displayModelLabel(lastRouteInfo.model)} via ${lastRouteInfo.provider === "ollama" ? "local" : lastRouteInfo.provider}`
                  : ""}
                activeMode={mode}
                groqKeyDraft={groqByokDraft}
                onGroqKeyDraftChange={setGroqByokDraft}
                groqKeySaved={groqByokSaved}
                onSaveGroqKey={() => {
                  const trimmed = groqByokDraft.trim();
                  if (!trimmed) return;
                  try {
                    localStorage.setItem(GROQ_BYOK_KEY, trimmed);
                    setGroqByokSaved(true);
                    setGroqByokDraft("");
                  } catch { /* quota */ }
                }}
                onClearGroqKey={() => {
                  try { localStorage.removeItem(GROQ_BYOK_KEY); } catch { /* ignore */ }
                  setGroqByokSaved(false);
                  setGroqByokDraft("");
                }}
              />
            )}
          </div>
        </div>
      </main>

      {/* ── Intel panel separator + collapse toggle (desktop) ───────────── */}
      {!isAnalytics && (
      <div className="hidden lg:flex items-stretch relative shrink-0 z-20">
        <div className="w-px bg-white/6 h-full" />
        {/* Button anchored to the LEFT of the separator — always fully visible */}
        <button
          onClick={() => setIsIntelOpen(p => !p)}
          title={isIntelOpen ? "Collapse panel" : "Expand panel"}
          aria-label={isIntelOpen ? "Collapse intelligence panel" : "Expand intelligence panel"}
          className={cn(
            "absolute top-1/2 -translate-y-1/2",
            "flex size-10 items-center justify-center",
            "rounded-full border-2 bg-[#0d0d11]",
            "transition-all duration-300",
            isIntelOpen
              ? "right-0 translate-x-1/2 border-white/10 text-white/30 hover:border-white/25 hover:text-white/70 hover:bg-white/8"
              : "right-0 -translate-x-[calc(100%+6px)] border-indigo-500/40 text-indigo-400/80 hover:border-indigo-400/60 hover:text-indigo-400 hover:bg-indigo-400/10 shadow-xl shadow-indigo-900/40",
          )}
        >
          {/* Arrow faces RIGHT (→) when panel is open = "push it in"; LEFT (←) when closed = "pull it out" */}
          <ChevronLeft className={cn(
            "size-5 transition-transform duration-300",
            isIntelOpen && "rotate-180",
          )} />
        </button>
      </div>
      )}

      {/* ── Intelligence panel (desktop) ─────────────────────────────────── */}
      {!isAnalytics && (
      <aside className={cn(
        "hidden lg:flex shrink-0 flex-col bg-sidebar overflow-hidden",
        "transition-[width,opacity] duration-300 ease-in-out",
        isIntelOpen ? "w-72 xl:w-80 opacity-100" : "w-0 opacity-0",
      )}>
        <div className={cn(
          "flex-1 min-h-0 px-4 py-5 overflow-hidden flex flex-col w-72 xl:w-80",
          "transition-opacity duration-200",
          !isIntelOpen && "pointer-events-none",
        )}>
          {IntelligencePanel}
        </div>
      </aside>
      )}
    </div>
  );
}

// ─── Helper component ─────────────────────────────────────────────────────────

function IntelCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-white/4 border border-white/6 px-3 py-3 space-y-1.5">
      <p className="text-[0.6rem] uppercase tracking-[0.25em] text-white/30 font-semibold">{label}</p>
      <div className="text-sm text-white/70">{children}</div>
    </div>
  );
}
