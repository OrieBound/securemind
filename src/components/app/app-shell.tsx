"use client";

import {
  BarChart2,
  Bookmark,
  BookOpen,
  Brain,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  FileText,
  GripVertical,
  Loader2,
  MessageSquare,
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
  Sparkles,
  Square,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
} from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { InsightsSubjectScope } from "@/components/analytics/analytics-shell";
import {
  readStashedInsightsSubject,
  stashInsightsSubject,
} from "@/lib/analytics/insights-subject-client";

import {
  GETTING_STARTED_PATH,
  chatUnreachableMessage,
  markBedrockHighlight,
  noModelAssistantReply,
} from "@/lib/onboarding";

/** Survives /analytics → / remount so Back to Admin reopens Settings → Admin. */
const OPEN_SETTINGS_KEY = "sm_open_settings";

import { ComposerInput, type ComposerInputHandle, type ComposerVoiceInsert } from "@/components/app/composer-input";
import { VoiceSttSetupDialog } from "@/components/app/voice-stt-setup";
import { recordingToWav } from "@/lib/transcribe/browser-wav";
import {
  startCloudLiveStt,
  supportsLivePcmUpload,
  type CloudLiveSttHandle,
} from "@/lib/transcribe/live-client";
import { parseVoiceSttChoice, voiceCaptionMode, voiceProviderDestination, voiceProviderLabel } from "@/lib/transcribe/backend";
import {
  ModelSetupPanel,
  RuntimeStatusBar,
  type RuntimeStatusPayload,
} from "@/components/app/model-setup-panel";
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
import {
  KnowledgeDetail,
  KnowledgeLibraryFilters,
  knowledgeLibraryKind,
  type KnowledgeLibraryFilter,
} from "@/components/app/knowledge-detail";
import {
  ModelCatalogProvider,
  ProviderBadge,
  buildChatPickerModels,
  guessProvider,
  isChatSelectableModel,
  modelDisplayName,
  useModelCatalog,
} from "@/components/app/model-catalog";
import { ComplexityTiersEditor, type ComplexityTiersBind } from "@/components/app/complexity-tiers-editor";
import { SessionAvatar } from "@/components/app/user-avatar";
import { isReferenceOnlyModel } from "@/lib/models/reference-catalog";
import { catalogSelectionStatus } from "@/lib/models/model-availability";
import {
  DEFAULT_TIER_MODELS,
  displayModelForTier,
  effectiveTierOverrides,
  sanitizeTierOverrides,
} from "@/lib/models/tier-assignment";
import { isChatUsableModelId } from "@/lib/models/catalog-shared";
import { formatGroqChatError } from "@/lib/models/groq-connectivity";
import {
  DEFAULT_COST_BASELINE_MODEL,
  GROQ_MODEL_PRICING,
  estimateBaselineCostUsd,
  estimateInferenceCost,
} from "@/lib/pricing";
import { useTheme } from "@/components/app/theme-provider";
import { useAuthSession } from "@/components/app/auth-session";
import {
  LEFT_SIDEBAR_DEFAULT,
  LEFT_SIDEBAR_KEY,
  LEFT_SIDEBAR_MAX,
  LEFT_SIDEBAR_MIN,
  PanelResizeHandle,
  RIGHT_SIDEBAR_DEFAULT,
  RIGHT_SIDEBAR_KEY,
  RIGHT_SIDEBAR_MAX,
  RIGHT_SIDEBAR_MIN,
  SETTINGS_NAV_HEIGHT_DEFAULT,
  SETTINGS_NAV_HEIGHT_KEY,
  SETTINGS_NAV_HEIGHT_MAX,
  SETTINGS_NAV_HEIGHT_MIN,
  SidebarResizeHandle,
  useResizableHeight,
  useSidebarWidth,
} from "@/components/app/sidebar-resize";
import { INTEL_HEIGHT, IntelPanelStack } from "@/components/app/intel-panels";
import {
  InsightsTabsList,
  useInsightsTabOrder,
  type InsightsTabId,
} from "@/components/app/insights-nav";
import {
  WorkspaceFeatureNav,
  useWorkspaceFeatureOrder,
  type WorkspaceFeatureId,
} from "@/components/app/workspace-feature-nav";
import {
  reorderIds,
  useWorkspaceListOrder,
} from "@/components/app/workspace-list-order";
import { SecurityAnalyticsView } from "@/components/analytics/security-view";
import { UsageAnalyticsView } from "@/components/analytics/usage-view";
import { CostAnalyticsView } from "@/components/analytics/cost-view";
import {
  fetchAnalyticsJson,
  postSecurityEvents,
} from "@/lib/analytics/client";
import type { AnalyticsRange } from "@/lib/analytics/types";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import EmojiPicker, { Theme, type EmojiClickData } from "emoji-picker-react";
import {
  apiAuthHeaders,
  apiUrl,
  ensureClientAccessToken,
  sessionApiFetch,
  usesRemoteApi,
  warmChatConnection,
} from "@/lib/client/api-base";
import { PRODUCT_CHROME_TAGLINE, PRODUCT_POSITIONING } from "@/lib/branding";
import { ProductMark } from "@/components/app/product-mark";
import { themeForRuntime } from "@/lib/provider-theme";
import { cn } from "@/lib/utils";
import {
  scrubPII,
  allScannedCategories,
  categoriesForTier,
  categoryLabel,
  validateSafeTerm,
  omitRetiredDefaultSafeTerms,
  parsePiiSensitivityTier,
  isShippedDefaultSafeTerm,
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
import {
  ATTACHMENT_LIMITS_HINT,
  attachedDocumentNamesFromText,
  formatAttachmentsForHistory,
  MAX_ATTACHMENT_PROMPT_CHARS,
  MAX_ATTACHMENTS_PER_TURN,
  stripAttachedDocumentBlock,
} from "@/lib/attachments";

// ─── types ────────────────────────────────────────────────────────────────────

type RouteInfo = {
  provider: "groq" | "ollama" | "bedrock";
  model: string;
  mode: string;
  isVision?: boolean;
  wasAutoRouted?: boolean;
  costTier?: "free" | "$" | "$$" | "$$$";
  latencyMs?: number;  // time-to-first-token from send
  costUsd?: number;    // list-rate estimate from token usage (undefined if unpriced)
  savedUsd?: number;   // estimated savings vs baseline model
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
  /** Machine-readable setup error — e.g. VENDOR_RISK_REQUIRED → Settings link. */
  errorCode?: string;
  errorSettingsSection?: SettingsSection;
  images?: string[];   // base64 data URLs for inline image display
  /** Filenames attached on this user turn — shown on the bubble after Send. */
  attachedFiles?: string[];
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
  /** True when Knowledge already had this name+size in the workspace. */
  reused?: boolean;
  processingError?: string | null;
  hasOriginal?: boolean;
  extractMeta?: {
    kind?: string;
    sheets?: { name: string; headers: string[]; rowCount: number }[];
    imageScan?: {
      textScanned: boolean;
      metadataFound: boolean;
      metadataRemoved: boolean;
      visualScan: "unavailable" | "limited" | "completed";
      filenameScanned: boolean;
      note: string;
    };
  } | null;
};

type DocFragment = { id: string; content: string; createdAt: string; provenance?: { range?: string; sheet?: string } | null };

type DocDetail = DocRecord & {
  content:   string;
  fragments: DocFragment[];
  fragmentTotal?: number;
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
  attachedFileNames: string[];
  attachmentExtracts: { id: string; name: string; content: string }[];
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
  attachedFileNames?: string[];
  attachmentExtracts?: { id: string; name: string; content: string }[];
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
const DEFAULT_MODE_MODELS: Record<string, string> = DEFAULT_TIER_MODELS;

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
  "Social Insurance numbers": Hash,
  "IPv4 addresses": Globe,
  "Street addresses": MapPin,
  "Passport / national ID patterns": Fingerprint,
  "API keys & secrets": KeyRound,
};

type RouteHit = {
  tier: string;
  model: string;
  provider?: string;
  at: string;
  workspaceId?: string;
  promptTokens?: number;
  completionTokens?: number;
  costUsd?: number;
  savedUsd?: number;
};
type StatsRange = "today" | "weekly" | "monthly" | "all";

const ROUTE_HISTORY_KEY = "sm_route_history";
const SAVINGS_BASELINE_KEY = "sm_savings_baseline";
const TIER_MODEL_OVERRIDES_KEY = "sm_tier_model_overrides";
const MODEL_SELECTION_MODE_KEY = "sm_model_selection_mode";
const FIXED_MODEL_ID_KEY = "sm_fixed_model_id";
const TIER_CHANGED_FLASH_MS = 4500;
const SETTINGS_TRANSITION_MS = 300;
const viewTransition = "transition-all duration-300 ease-in-out";
const PII_ARCHIVE_KEY     = "sm_pii_archive";
const PII_DISMISSED_KEY   = "sm_pii_dismissed";
const PII_SENSITIVITY_KEY = "sm_pii_sensitivity";
const SAFE_TERMS_KEY      = "sm_safe_terms";

/** Keys written by the removed approve-to-expose flow. Purged on first load. */
const LEGACY_PII_APPROVALS_KEY = "sm_pii_approvals";
const PII_PURGE_FLAG_KEY       = "sm_pii_purged_v2";
const STORAGE_SWEEP_FLAG_KEY   = "sm_storage_swept_v1";

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

/** Drop superseded Insights / sidebar layout keys from earlier iterations. */
function sweepOrphanedStorageKeys() {
  try {
    if (localStorage.getItem(STORAGE_SWEEP_FLAG_KEY)) return;
    const keepExact = new Set([
      "sm_intel_panels_usage_v6",
      "sm_intel_panels_security_v2",
      "sm_intel_panels_cost_v3",
      "sm_right_sidebar_w_v4",
      "sm_insights_tab_order_v2",
    ]);
    const orphanExact = [
      "sm_intel_panels_security",
      "sm_intel_panels_cost",
      "sm_right_sidebar_w",
      "sm_right_sidebar_w_v2",
      "sm_right_sidebar_w_v3",
      "sm_insights_tab_order",
    ];
    for (const key of orphanExact) localStorage.removeItem(key);
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (!key || keepExact.has(key)) continue;
      if (
        /^sm_intel_panels_usage_v[1-5]$/.test(key)
        || /^sm_intel_panels_security_v1$/.test(key)
        || /^sm_intel_panels_cost_v[12]$/.test(key)
      ) {
        localStorage.removeItem(key);
      }
    }
    localStorage.setItem(STORAGE_SWEEP_FLAG_KEY, new Date().toISOString());
  } catch {
    /* storage unavailable */
  }
}

function persistPiiArchive(entries: SessionScrubEntry[]) {
  try { localStorage.setItem(PII_ARCHIVE_KEY, JSON.stringify(entries)); } catch { /* quota */ }
}

function persistSafeTerms(terms: SafeTerm[]) {
  try { localStorage.setItem(SAFE_TERMS_KEY, JSON.stringify(omitRetiredDefaultSafeTerms(terms))); } catch { /* quota */ }
}

function persistPiiDismissed(ids: Set<string>) {
  try { localStorage.setItem(PII_DISMISSED_KEY, JSON.stringify([...ids])); } catch { /* quota */ }
}

function workspaceDisplay(workspaces: Workspace[], workspaceId?: string): { name: string; emoji?: string } {
  if (!workspaceId) return { name: "Unknown workspace" };
  const a = workspaces.find(x => x.id === workspaceId);
  return a ? { name: a.name, emoji: a.emoji } : { name: "Removed workspace" };
}

/** Keep only workspace-tagged hits so All = sum of per-workspace counts. */
function taggedRouteHits(hits: RouteHit[], knownWorkspaceIds?: Set<string>): RouteHit[] {
  return hits.filter(h => {
    // Keep unscoped hits so All still shows turns recorded before workspace id was set.
    if (!h.workspaceId) return true;
    if (knownWorkspaceIds && !knownWorkspaceIds.has(h.workspaceId)) return false;
    return true;
  });
}

/** Insights rail ranges → analytics API ranges. */
function statsRangeToAnalytics(range: StatsRange): AnalyticsRange {
  if (range === "today") return "today";
  if (range === "weekly") return "7d";
  if (range === "monthly") return "30d";
  return "all";
}

type InsightsCostPayload = {
  kpis: {
    estimatedCostUsd: number;
    routingSavingsUsd: number;
    pricedRequests: number;
    unpricedRequests: number;
  };
  byModel: { model: string; costUsd: number }[];
};

function persistRouteHistory(hits: RouteHit[]) {
  try { localStorage.setItem(ROUTE_HISTORY_KEY, JSON.stringify(hits)); } catch { /* quota */ }
}

function navTitle(nav: NavId): string {
  if (nav === "home") return "Home";
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
              "font-semibold text-foreground/90 hover:bg-foreground/5",
              open && "bg-foreground/8",
            )}
          >
            <span className="truncate">{agent.name}</span>
            <ChevronDown className={cn("size-3 text-foreground/35 shrink-0 transition-transform", open && "rotate-180")} aria-hidden />
          </button>
          {open && (
            <div className="absolute top-full left-0 mt-1 z-30 w-52 rounded-xl bg-popover border border-foreground/10 shadow-2xl shadow-black/60 py-1 overflow-hidden">
              <p className="px-3 py-1.5 text-[0.6rem] uppercase tracking-widest text-foreground/25">Switch workspace</p>
              {workspaces.map(a => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => onSelectAgent(a.id)}
                  className={cn(
                    "flex w-full items-center gap-2.5 px-3 py-2 text-sm transition-colors text-left cursor-pointer",
                    a.id === agent.id
                      ? "text-foreground/85 bg-foreground/6"
                      : "text-foreground/45 hover:bg-foreground/5 hover:text-foreground/70",
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
        <span className="font-semibold text-foreground/90 truncate">{agent.name}</span>
      ) : null}
      {agent && (
        <>
          <ChevronRight className="size-3.5 text-foreground/25 shrink-0" aria-hidden />
          <span className="text-foreground/45 truncate font-medium">{sectionLabel}</span>
        </>
      )}
      {!agent && <span className="font-semibold text-foreground/70">{sectionLabel}</span>}
    </nav>
  );
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfWeek(): Date {
  const d = new Date();
  d.setDate(d.getDate() - 6);
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
  const t0 =
    range === "today"   ? startOfToday().getTime()
    : range === "weekly" ? startOfWeek().getTime()
    : startOfMonth().getTime();
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
    { id: "weekly",  label: "Weekly" },
    { id: "monthly", label: "Monthly" },
    { id: "all",     label: "All time" },
  ];
  return (
    <div className="flex gap-1.5 p-1 bg-foreground/5 rounded-lg border border-foreground/10">
      {options.map(opt => (
        <button
          key={opt.id}
          type="button"
          onClick={() => onChange(opt.id)}
          className={cn(
            "flex-1 min-w-0 whitespace-nowrap text-[0.68rem] font-medium rounded-md px-2.5 py-1.5 transition-all",
            value === opt.id
              ? "bg-elevated text-foreground shadow-sm border border-border"
              : "text-foreground/45 hover:text-foreground/70",
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
  models,
}: {
  value: string;
  onChange: (modelId: string) => void;
  models: Array<{ id: string; name: string; provider: Parameters<typeof ProviderBadge>[0]["provider"] }>;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = models.find(m => m.id === value);

  const options = useMemo(() => {
    const pricedGroq = models.filter(m => m.provider === "groq" && m.id in GROQ_MODEL_PRICING);
    const pricedIds = new Set(pricedGroq.map(m => m.id));
    const rest = models.filter(m => !pricedIds.has(m.id));
    return [...pricedGroq, ...rest];
  }, [models]);

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
        <span className="text-[0.62rem] font-medium text-foreground/35 shrink-0">Baseline model</span>
        <div className="relative flex-1 min-w-0">
          <button
            type="button"
            onClick={() => setOpen(p => !p)}
            aria-haspopup="listbox"
            aria-expanded={open}
            className={cn(
              "flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-colors cursor-pointer",
              open ? "border-indigo-400/35 bg-indigo-500/10" : "border-foreground/10 bg-foreground/[0.04] hover:bg-foreground/[0.06]",
            )}
          >
            <span className="flex items-center gap-1.5 min-w-0 text-[0.68rem] text-foreground/70 truncate">
              {selected && <ProviderBadge provider={selected.provider} />}
              <span className="truncate">{selected?.name ?? displayModelLabel(value)}</span>
            </span>
            <ChevronDown className={cn("size-3 text-foreground/35 shrink-0 transition-transform", open && "rotate-180")} aria-hidden />
          </button>
          {open && (
            <ul
              role="listbox"
              className="absolute z-30 mt-1 w-full max-h-56 overflow-y-auto rounded-xl border border-foreground/10 bg-popover py-1 shadow-2xl shadow-black/60"
            >
              {options.map(m => (
                <li key={`${m.provider}:${m.id}`}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={m.id === value}
                    onClick={() => { onChange(m.id); setOpen(false); }}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[0.68rem] transition-colors cursor-pointer",
                      m.id === value ? "bg-indigo-500/15 text-indigo-200" : "text-foreground/50 hover:bg-foreground/5 hover:text-foreground/75",
                    )}
                  >
                    <span className="flex items-center gap-1.5 min-w-0">
                      <ProviderBadge provider={m.provider} />
                      <span className="truncate">{m.name}</span>
                    </span>
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
        <span className="text-[0.62rem] font-medium text-foreground/35 shrink-0">Workspace</span>
        <div className="relative flex-1 min-w-0">
          <button
            type="button"
            onClick={() => setOpen(p => !p)}
            aria-haspopup="listbox"
            aria-expanded={open}
            className={cn(
              "flex w-full items-center justify-between gap-2 h-7 rounded-md px-2",
              "bg-foreground/5 border border-foreground/8 text-[0.68rem] text-foreground/70",
              "hover:bg-foreground/[0.07] hover:border-foreground/12 transition-colors cursor-pointer",
              open && "border-foreground/15 bg-foreground/[0.07]",
            )}
          >
            <span className="truncate text-left">{selectedLabel}</span>
            <ChevronDown className={cn("size-3 shrink-0 text-foreground/35 transition-transform", open && "rotate-180")} aria-hidden />
          </button>
          {open && (
            <div
              role="listbox"
              className="absolute top-full left-0 right-0 mt-1 z-30 rounded-xl bg-popover border border-foreground/10 shadow-2xl shadow-black/60 py-1 overflow-hidden max-h-48 overflow-y-auto"
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
                      ? "text-foreground/85 bg-foreground/6"
                      : "text-foreground/50 hover:bg-foreground/5 hover:text-foreground/75",
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

// ─── pricing (list-rate estimates — shared with server analytics) ─────────────
const DEFAULT_SAVINGS_BASELINE = DEFAULT_COST_BASELINE_MODEL;
/** Fallback token split when exact usage wasn't captured (est. ~700 tokens/turn). */
const EST_PROMPT_TOKENS = 500;
const EST_COMPLETION_TOKENS = 200;

function providerForHit(hit: RouteHit): string {
  return hit.provider ?? guessProvider(hit.model) ?? "groq";
}

function calcTurnCost(
  provider: string,
  model: string,
  promptTokens: number,
  completionTokens: number,
  baselineModel = DEFAULT_SAVINGS_BASELINE,
): { costUsd: number; savedUsd: number } | null {
  const actual = estimateInferenceCost({ provider, model, promptTokens, completionTokens });
  if (!actual.priced || actual.estimatedCostUsd == null) return null;
  const baseline = estimateBaselineCostUsd(promptTokens, completionTokens, baselineModel);
  const savedUsd = baseline == null ? 0 : Math.max(0, baseline - actual.estimatedCostUsd);
  return { costUsd: actual.estimatedCostUsd, savedUsd };
}

function turnCostForHit(hit: RouteHit, baselineModel: string): { costUsd: number; savedUsd: number } | null {
  const provider = providerForHit(hit);
  if (hit.promptTokens != null && hit.completionTokens != null) {
    return calcTurnCost(provider, hit.model, hit.promptTokens, hit.completionTokens, baselineModel);
  }
  // Without tokens, only Ollama can be priced ($0); cloud needs usage.
  if (provider === "ollama") {
    return calcTurnCost(provider, hit.model, 0, 0, baselineModel);
  }
  return calcTurnCost(provider, hit.model, EST_PROMPT_TOKENS, EST_COMPLETION_TOKENS, baselineModel);
}

function fmtUsd(d: number): string {
  if (d === 0) return "$0.00";
  if (d < 0.0001) return "<$0.0001";
  return `$${d.toFixed(4)}`;
}

// ─── constants ────────────────────────────────────────────────────────────────

const DEFAULT_WORKSPACE_NAME = "Mindy Locke";

// Complexity tiers — ordered most capable → cheapest (mirrors router.ts COMPLEXITY_TIERS)
const MODES = [
  "Max",
  "Plus",
  "Standard",
  "Light",
  "Micro",
] as const;
type Mode = (typeof MODES)[number];

function isMode(value: string): value is Mode {
  return (MODES as readonly string[]).includes(value);
}

function parseTierModelOverrides(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const next: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (isMode(key) && typeof value === "string" && value.trim()) {
        next[key] = value.trim();
      }
    }
    return sanitizeTierOverrides(next);
  } catch {
    return {};
  }
}

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
type NavId =
  | (typeof SUB_NAV_ITEMS)[number]["id"]
  | "home"
  | "workspace-settings"
  | "settings"
  | "security-dashboard";

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
  if (mimeType.includes("spreadsheet") || mimeType === "application/vnd.ms-excel") {
    return { label: "XLSX", cls: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" };
  }
  if (mimeType.includes("wordprocessingml")) {
    return { label: "DOCX", cls: "text-sky-400 bg-sky-500/10 border-sky-500/20" };
  }
  if (mimeType.startsWith("image/")) return { label: "IMG", cls: "text-fuchsia-400 bg-fuchsia-500/10 border-fuchsia-500/20" };
  if (mimeType.startsWith("text/x-"))  return { label: "CODE", cls: "text-violet-400 bg-violet-500/10 border-violet-500/20" };
  return { label: "TXT", cls: "text-foreground/40 bg-foreground/5 border-foreground/10" };
}

// ─── Redacted inline block ────────────────────────────────────────────────────

function RedactedBlock({ category }: { category: string }) {
  return (
    <span
      aria-label={`${category} removed for privacy`}
      className="inline-flex items-center gap-1 mx-0.5 rounded-md px-2 py-0.5 align-middle
                 bg-foreground/8 border border-foreground/10
                 text-[0.68rem] font-mono text-foreground/40 select-none cursor-default"
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
        className={cn(
          "workspace-avatar shrink-0 rounded-xl flex items-center justify-center select-none",
          cls,
        )}
        style={{ "--ws-accent": color } as CSSProperties}
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
        "bg-gradient-to-br from-indigo-500 to-violet-600 text-foreground shadow-lg shadow-indigo-900/30",
        cls,
      )}
    >
      {nameInitials(name)}
    </div>
  );
}

function formatThinkingElapsed(ms: number): string {
  if (ms < 1000) return `${(ms / 1000).toFixed(1)}s`;
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min > 0) return `${min}:${String(sec).padStart(2, "0")}`;
  return `${totalSec}s`;
}

const OLLAMA_LOCAL_WAIT_COPY =
  "This pause is Ollama running on your machine — not a SecureMind outage or hang. " +
  "Local speed depends on your CPU or GPU; 10–40 seconds before the first word is common without a GPU.";

const OLLAMA_FASTER_PATH_COPY =
  "For a faster reply, connect Amazon Bedrock or a vendor API (for example Groq) in Settings. " +
  "Those run off this computer and may incur cost.";

/** Visible thinking state while waiting for the first token (common with local Ollama). */
function ThinkingIndicator({
  startedAt,
  provider,
  onStop,
  onOpenSettings,
  compact = false,
}: {
  startedAt: number;
  provider?: string;
  onStop?: () => void;
  onOpenSettings?: (section: SettingsSection) => void;
  compact?: boolean;
}) {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    const tick = () => setElapsedMs(Date.now() - startedAt);
    tick();
    const id = window.setInterval(tick, 100);
    return () => window.clearInterval(id);
  }, [startedAt]);

  const isOllama = provider === "ollama";
  const slowCloudHint =
    !isOllama && elapsedMs >= 8000 ? "Still processing your request…" : null;

  return (
    <div
      className={cn(
        "rounded-xl border border-indigo-500/20 bg-indigo-500/[0.08]",
        compact ? "px-3 py-2" : "px-3.5 py-3",
      )}
      role="status"
      aria-live="polite"
      aria-label={
        isOllama
          ? `Waiting on this computer, ${formatThinkingElapsed(elapsedMs)} elapsed`
          : `Thinking, ${formatThinkingElapsed(elapsedMs)} elapsed`
      }
    >
      <div className="flex items-center gap-2.5 flex-wrap">
        <Loader2 className="size-4 animate-spin text-indigo-300/90 shrink-0" aria-hidden />
        <span className="text-sm font-medium text-indigo-100/90">
          {isOllama ? "Waiting on your machine" : "Thinking"}
        </span>
        <span className="text-xs font-mono tabular-nums text-indigo-200/55">
          {formatThinkingElapsed(elapsedMs)}
        </span>
        {provider && (
          <span className={cn(
            "text-[0.58rem] uppercase tracking-wider font-semibold",
            themeForRuntime(provider).icon,
            "opacity-80",
          )}>
            {themeForRuntime(provider).label}
          </span>
        )}
        {onStop && (
          <button
            type="button"
            onClick={onStop}
            className={cn(
              "ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1",
              "text-[0.68rem] font-medium text-muted-foreground bg-muted/80 border border-border",
              "hover:bg-muted hover:text-foreground transition-colors cursor-pointer",
            )}
            aria-label="Stop generating"
          >
            <Square className="size-2.5 fill-current" aria-hidden />
            Stop
          </button>
        )}
      </div>
      {isOllama && (
        <div className={cn("pl-6 space-y-1.5", compact ? "mt-1.5" : "mt-2")}>
          <p className="text-[0.68rem] leading-relaxed text-indigo-100/75">
            {OLLAMA_LOCAL_WAIT_COPY}
          </p>
          <p className="text-[0.68rem] leading-relaxed text-indigo-200/50">
            {OLLAMA_FASTER_PATH_COPY}
          </p>
          {onOpenSettings && (
            <button
              type="button"
              onClick={() => onOpenSettings("inference")}
              className="text-[0.68rem] font-medium text-indigo-200 underline underline-offset-2 hover:text-indigo-100 cursor-pointer"
            >
              Open Settings → Models
            </button>
          )}
        </div>
      )}
      {slowCloudHint && (
        <p className="mt-2 text-[0.68rem] leading-relaxed text-indigo-200/45 pl-6">
          {slowCloudHint}
        </p>
      )}
    </div>
  );
}

// ─── MessageBubble ────────────────────────────────────────────────────────────

const MessageBubble = memo(function MessageBubble({
  message,
  workspaceName,
  workspaceEmoji,
  workspaceColor,
  onBookmark,
  onOpenSettings,
  highlighted = false,
  showTimestamp = true,
  isThinking = false,
  thinkingStartedAt,
  onStopThinking,
}: {
  showTimestamp?: boolean;
  message: ChatMessage;
  /** Workspace name doubles as the assistant speaker identity in chat. */
  workspaceName: string;
  workspaceEmoji?: string;
  workspaceColor?: string;
  onBookmark: (id: string) => void;
  onOpenSettings?: (section: SettingsSection) => void;
  highlighted?: boolean;
  isThinking?: boolean;
  thinkingStartedAt?: number;
  onStopThinking?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const isUser = message.role === "user";
  const displayContent = isUser ? stripAttachedDocumentBlock(message.content) : message.content;
  const attachedNames = isUser
    ? (message.attachedFiles?.length
        ? message.attachedFiles
        : attachedDocumentNamesFromText(message.content))
    : [];

  const body = isUser && message.segments ? (
    <p className="text-chat whitespace-pre-wrap break-words [overflow-wrap:anywhere] min-w-0">
      {message.segments.map((seg, i) =>
        seg.redacted
          ? <RedactedBlock key={i} category={seg.category} />
          : <span key={i} className="[overflow-wrap:anywhere]">{seg.text}</span>,
      )}
    </p>
  ) : (
    <div className="min-w-0 max-w-full overflow-hidden">
      {message.error
        ? (
          <span className="text-body flex flex-col gap-2 text-amber-100/90 break-words [overflow-wrap:anywhere]">
            <span className="flex items-start gap-2">
              <span className="shrink-0 mt-0.5 text-amber-300/90">⚠</span>
              <span>{
                message.errorCode === "VENDOR_RISK_REQUIRED" ||
                message.errorCode === "GROQ_NOT_CONFIGURED" ||
                message.errorCode === "BEDROCK_NOT_CONFIGURED" ||
                message.errorCode === "MODEL_PROVIDER_REQUIRED" ||
                message.errorCode === "OLLAMA_EMBED_MODEL"
                  ? message.error
                  : message.errorCode === "OLLAMA_MODEL_MISSING"
                    ? `Setup needed: ${message.error.replace(/^Setup needed:\s*/i, "")}`
                  : /^[45]\d\d/.test(message.error)
                    ? formatGroqChatError(message.error)
                    : message.error
              }</span>
            </span>
            {(message.errorCode === "VENDOR_RISK_REQUIRED" ||
              message.errorCode === "GROQ_NOT_CONFIGURED" ||
              message.errorCode === "BEDROCK_NOT_CONFIGURED" ||
              message.errorCode === "MODEL_PROVIDER_REQUIRED" ||
              message.errorSettingsSection ||
              /console\.groq\.com|api\.groq\.com|rejected this API key/i.test(message.error)) &&
              onOpenSettings && (
              <button
                type="button"
                onClick={() => {
                  markBedrockHighlight();
                  onOpenSettings(message.errorSettingsSection ?? "providers");
                }}
                className="self-start ml-6 text-[0.72rem] font-medium text-indigo-200 underline underline-offset-2 hover:text-indigo-100 cursor-pointer"
              >
                Open Settings → {SETTINGS_SECTION_LABELS[message.errorSettingsSection ?? "providers"]}
              </button>
            )}
            {(message.errorCode === "VENDOR_RISK_REQUIRED" ||
              message.errorCode === "GROQ_NOT_CONFIGURED" ||
              message.errorCode === "BEDROCK_NOT_CONFIGURED" ||
              message.errorCode === "MODEL_PROVIDER_REQUIRED" ||
              /chat service|Getting started/i.test(message.error ?? "")) && (
              <a
                href={GETTING_STARTED_PATH}
                className="self-start ml-6 text-[0.72rem] font-medium text-indigo-200 underline underline-offset-2 hover:text-indigo-100"
              >
                Open Getting started guide
              </a>
            )}
          </span>
        )
        : displayContent
          ? (
            <div className="chat-prose min-w-0 max-w-full">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  a: ({ href, children }) => {
                    const internal = Boolean(href?.startsWith("/") && !href.startsWith("//"));
                    return (
                      <a
                        href={href}
                        onClick={() => {
                          if (href?.includes("highlight=bedrock")) markBedrockHighlight();
                        }}
                        {...(!internal ? { target: "_blank", rel: "noreferrer noopener" } : {})}
                      >
                        {children}
                      </a>
                    );
                  },
                }}
              >
                {isUser ? displayContent : message.content}
              </ReactMarkdown>
            </div>
          )
          : message.role === "assistant" && isThinking && thinkingStartedAt
            ? (
              <ThinkingIndicator
                startedAt={thinkingStartedAt}
                provider={message.routeInfo?.provider}
                onStop={onStopThinking}
                onOpenSettings={onOpenSettings}
              />
            )
          : message.role === "assistant"
            ? (
              <span className="inline-flex gap-1 items-center">
                <span className="animate-bounce delay-0   size-1.5 rounded-full bg-foreground/30 inline-block" />
                <span className="animate-bounce delay-150 size-1.5 rounded-full bg-foreground/30 inline-block" />
                <span className="animate-bounce delay-300 size-1.5 rounded-full bg-foreground/30 inline-block" />
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
        <div className="relative max-w-[75%] min-w-0">
          {/* Bookmark button */}
          <button
            onClick={() => onBookmark(message.id)}
            aria-label={message.bookmarked ? "Remove from saved" : "Save conclusion"}
            className={cn(
              "absolute -top-2 -left-7 rounded-full p-1 transition-all duration-150",
              "bg-foreground/5 border border-foreground/8 hover:bg-foreground/10",
              hovered || message.bookmarked ? "opacity-100" : "opacity-0 pointer-events-none",
              message.bookmarked && "text-primary",
            )}
          >
            <Bookmark className={cn("size-3", message.bookmarked && "fill-current")} aria-hidden />
          </button>

          <div className="rounded-2xl rounded-tr-sm bg-[var(--primary-soft)] border border-[var(--primary-border)] dark:bg-foreground/8 dark:border-foreground/8 px-4 py-3 min-w-0 max-w-full overflow-hidden [overflow-wrap:anywhere]">
            {/* Attached images */}
            {message.images && message.images.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2.5">
                {message.images.map((src, i) => (
                  <img
                    key={i}
                    src={src}
                    alt="attachment"
                    className="max-h-48 max-w-full rounded-xl object-cover border border-foreground/10"
                  />
                ))}
              </div>
            )}
            {attachedNames.length > 0 && (
              <ul className="mb-2.5 space-y-1.5" aria-label="Files attached to this message">
                {attachedNames.map(name => (
                  <li
                    key={name}
                    className="flex items-center gap-2 rounded-lg border border-[var(--primary-border)] bg-background/40 px-2.5 py-1.5"
                  >
                    <FileText className="size-3.5 shrink-0 text-foreground/70" aria-hidden />
                    <span className="min-w-0">
                      <span className="block truncate text-[0.78rem] font-medium text-foreground/90">{name}</span>
                      <span className="block text-[0.65rem] text-foreground/45">Attached to this message</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {body}
            {message.scrubEvents && message.scrubEvents.length > 0 && (
              <p className="text-meta mt-2.5 flex items-center gap-1.5 border-t border-foreground/8 pt-2">
                <ShieldCheck className="size-3 shrink-0" aria-hidden />
                {message.scrubEvents.map(e => `${e.count} ${e.category}`).join(", ")} removed
              </p>
            )}
          </div>
          {showTimestamp && message.createdAt && (
            <p suppressHydrationWarning className="text-meta mt-1.5 text-right tabular-nums select-none">
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
            "bg-foreground/5 border border-foreground/8 hover:bg-foreground/10",
            hovered || message.bookmarked ? "opacity-100" : "opacity-0 pointer-events-none",
            message.bookmarked && "text-primary",
          )}
        >
          <Bookmark className={cn("size-3", message.bookmarked && "fill-current")} aria-hidden />
        </button>

        <p className="text-label mb-1.5 text-[var(--text-muted)]">{workspaceName}</p>
        <div className="min-w-0 max-w-full overflow-hidden [overflow-wrap:anywhere]">
          {body}
        </div>

        {/* Route badge — shows which mode + model handled this turn */}
        {message.routeInfo && !message.error && (
          <div className="mt-2.5 flex items-center gap-2 flex-wrap">
            <ProviderBadge
              provider={message.routeInfo.provider}
              className="text-[0.65rem] font-mono font-medium"
            />
            {/* Mode — with "auto" indicator when classifier picked it */}
            <span className="text-meta inline-flex items-center gap-1">
              {message.routeInfo.mode}
              {message.routeInfo.isVision && " · vision"}
              {message.routeInfo.wasAutoRouted && (
                <span className="text-[0.65rem] text-[var(--primary-soft-foreground)] font-mono uppercase tracking-wide opacity-70">auto</span>
              )}
            </span>
            <span className="text-meta opacity-50">·</span>
            <code className="text-meta font-mono">
              {message.routeInfo.model}
            </code>
            {message.routeInfo.latencyMs !== undefined && (
              <span className="text-meta tabular-nums">
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
              <p className="text-meta flex items-center gap-1.5 text-amber-200/70">
                <ShieldAlert className="size-3 shrink-0" aria-hidden />
                No relevant workspace Knowledge for this question
              </p>
            )}
            {message.showGroundingBadge !== false && message.citationAudit && message.citationAudit.status !== "n/a" && message.citationAudit.status !== "not_applicable" && (
              <p
                className={cn(
                  "text-meta flex items-center gap-1.5",
                  message.citationAudit.status === "grounded" || message.citationAudit.status === "declined"
                    ? "text-emerald-300/70"
                    : message.citationAudit.status === "partial"
                      ? "text-amber-200/70"
                      : "text-red-300/75",
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
              <div className="rounded-xl border border-foreground/[0.07] bg-foreground/[0.02] px-3 py-2 space-y-1.5">
                <p className="text-[0.58rem] uppercase tracking-wider text-foreground/30 font-semibold">
                  Sources
                </p>
                <ul className="space-y-1">
                  {message.citations.map(c => (
                      <li key={c.fragmentId} className="flex items-start gap-2 text-[0.68rem] text-foreground/45">
                        <span className="shrink-0 font-mono text-indigo-300/80">
                          [{c.index}]
                        </span>
                        <span className="min-w-0">
                          <span className="text-foreground/55 font-medium">
                            {c.documentName ?? (c.category === "document" ? "Document" : "Memory")}
                          </span>
                          <span className="text-foreground/30"> — {c.preview}</span>
                        </span>
                      </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
        {showTimestamp && message.createdAt && !message.error && (
          <p suppressHydrationWarning className="text-meta mt-1.5 tabular-nums select-none">
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
        "group w-full text-left rounded-2xl border px-4 py-3.5 hover:bg-foreground/[0.08] transition-colors relative overflow-hidden cursor-pointer",
        bookmark.read
          ? "bg-foreground/[0.04] border-foreground/[0.08]"
          : "bg-foreground/7 border-indigo-400/20",
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
              ? "bg-foreground/[0.06] border-foreground/[0.08]"
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
                bookmark.read ? "text-foreground/55" : "text-foreground/85",
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
              <span className="text-[0.62rem] text-foreground/35 tabular-nums shrink-0 text-right leading-tight max-w-[9rem]">
                {timestamp}
              </span>
            )}
          </div>

          <p className={cn(
            "text-sm leading-relaxed line-clamp-4",
            bookmark.read ? "text-foreground/55" : "text-foreground/80",
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
            <p className="mt-2 flex items-center gap-1 text-[0.65rem] text-foreground/35">
              <Shield className="size-2.5 shrink-0" aria-hidden />
              Contains redacted content
            </p>
          )}

          <div className="mt-3 pt-2.5 border-t border-foreground/[0.06] flex items-center justify-between gap-2">
            <span className="text-[0.68rem] text-foreground/28 group-hover:text-indigo-300/85 transition-colors flex items-center gap-1.5">
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
              className="flex items-center gap-1 text-[0.65rem] text-foreground/25 hover:text-red-400/80 transition-colors px-1.5 py-0.5 rounded-md hover:bg-red-400/10"
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
          ? "border-[var(--primary-border)] bg-[var(--primary-soft)] scale-[1.01]"
          : "border-border bg-card hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]",
        uploading && "opacity-60 pointer-events-none",
      )}
    >
      <Upload className={cn(
        "mx-auto text-[var(--primary-soft-foreground)]",
        compact ? "size-4 mb-1" : "size-7 mb-3",
      )} aria-hidden />
      <p className={cn(
        "font-medium text-foreground",
        compact ? "text-[0.78rem]" : "text-sm",
      )}>
        {active ? "Drop to upload" : compact ? "Drag files here or click to browse" : "Drag & drop files here"}
      </p>
      <p className={cn(
        "text-muted-foreground leading-relaxed",
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
  onRetry,
}: {
  doc: DocRecord;
  onOpen: () => void;
  onDelete: () => void;
  onRetry?: () => void;
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
        "bg-card border-border shadow-[var(--shadow-sm)]",
        "hover:bg-[var(--surface-hover)] hover:border-[var(--border-strong)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <button
        type="button"
        onClick={e => { e.stopPropagation(); onDelete(); }}
        className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-lg hover:bg-[var(--destructive-soft)] text-muted-foreground hover:text-destructive"
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
        <p className="text-[0.8rem] font-semibold text-foreground leading-snug line-clamp-2 break-all">
          {doc.name}
        </p>
      </div>

      {!doc.workspaceId && (
        <p className="text-[0.62rem] text-warning mb-2">Unassigned — from a removed workspace</p>
      )}

      <div className="flex items-center gap-1.5 mb-2">
        <span className={cn(
          "size-1.5 rounded-full shrink-0",
          isProcessing ? "bg-warning animate-pulse" :
          isFailed     ? "bg-destructive" :
          isStored     ? "bg-warning" :
                         "bg-success",
        )} />
        <span className={cn(
          "text-[0.68rem] font-medium",
          isProcessing ? "text-warning" :
          isFailed     ? "text-destructive" :
          isStored     ? "text-warning" :
                         "text-success",
        )}>
          {isProcessing ? "Processing…" :
           isFailed     ? (doc.processingError ? `Failed · ${doc.processingError}` : "Needs attention") :
           isStored     ? "Stored · start Ollama to index" :
           `${doc.chunkCount} chunks indexed`}
        </span>
      </div>

      {doc.contentPreview && (
        <p className="text-[0.72rem] text-muted-foreground leading-relaxed line-clamp-3 mb-3">
          {doc.contentPreview}
        </p>
      )}

      {(doc.redactionCount ?? 0) > 0 && (
        <p className="flex items-center gap-1 text-[0.65rem] text-warning mb-2">
          <Shield className="size-2.5 shrink-0" aria-hidden />
          {doc.redactionCount} detected {doc.redactionCount === 1 ? "item" : "items"} replaced at upload
        </p>
      )}

      <p className="text-[0.65rem] text-[var(--text-subtle)] mb-3">
        {fmtBytes(doc.sizeBytes)} · {timeSince(doc.createdAt)}
      </p>

      <div className="pt-2.5 border-t border-border flex items-center justify-between gap-2">
        <span className="text-[0.68rem] font-medium text-[var(--primary-soft-foreground)] group-hover:text-primary transition-colors flex items-center gap-1.5">
          <FileText className="size-3 shrink-0" aria-hidden />
          View details
          <ChevronRight className="size-3 opacity-70 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" aria-hidden />
        </span>
        {isFailed && onRetry && (
          <button
            type="button"
            onClick={e => { e.stopPropagation(); onRetry(); }}
            className="text-[0.68rem] text-amber-200/80 hover:text-amber-100"
          >
            Retry
          </button>
        )}
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
  error,
  provider,
  onCancel,
  onConfirm,
}: {
  state: "requesting" | "listening" | "transcribing";
  waveHistory: number[];
  elapsed: number;
  liveText: { final: string; interim: string };
  previewPending: boolean;
  error: string | null;
  provider: "groq" | "transcribe" | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const mm = String(Math.floor(elapsed / 60)).padStart(1, "0");
  const ss = String(elapsed % 60).padStart(2, "0");
  const isListening = state === "listening";
  const isTranscribing = state === "transcribing";
  const displayText = (liveText.final + liveText.interim).trim();
  const showCaptions = isListening || (isTranscribing && Boolean(displayText));

  const transcriptRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [liveText]);

  return (
    <div className="flex flex-col px-4 pt-3 pb-2 gap-2.5">
      <div className="space-y-0.5">
        <p className="text-[0.72rem] font-semibold text-foreground/85">
          {voiceProviderLabel(provider)}
        </p>
        <p className="text-[0.62rem] text-foreground/45 leading-snug">
          {voiceProviderDestination(provider)}
        </p>
      </div>
      {showCaptions && (
        <div
          ref={transcriptRef}
          className="min-h-[52px] max-h-[80px] overflow-y-auto text-sm leading-relaxed"
        >
          {displayText ? (
            <p className="italic">
              <span className="text-foreground/40">{liveText.final}</span>
              <span className="text-foreground/28">{liveText.interim}</span>
              {(previewPending || isTranscribing) && (
                <span className="inline-block ml-1.5 size-1.5 rounded-full bg-foreground/25 animate-pulse align-middle not-italic" />
              )}
            </p>
          ) : (
            <p className="text-foreground/22 italic">
              {previewPending ? "Listening…" : "Start speaking…"}
            </p>
          )}
        </div>
      )}

      {isTranscribing && (
        <div className={cn("flex items-center justify-between gap-3", displayText ? "min-h-0" : "min-h-[52px]")}>
          <div className="flex items-center gap-2 text-sm text-foreground/40 min-w-0">
            <Loader2 className="size-4 animate-spin text-indigo-400/70 shrink-0" />
            {displayText ? "Finalizing transcription…" : "Transcribing…"}
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel transcription"
            title="Cancel transcription"
            className="shrink-0 p-1 rounded-md text-foreground/30 hover:text-red-400/80 hover:bg-red-400/10 transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>
      )}

      {state === "requesting" && (
        <p className="min-h-[52px] flex items-center text-sm text-foreground/30 animate-pulse">
          Requesting microphone…
        </p>
      )}

      {error && (
        <p className="text-[0.72rem] text-red-300/85 leading-relaxed">{error}</p>
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

          <span className="shrink-0 text-xs tabular-nums text-foreground/35 select-none">
            {mm}:{ss}
          </span>

          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel recording"
            className="shrink-0 p-1 rounded-md text-foreground/30 hover:text-red-400/80 hover:bg-red-400/10 transition-colors"
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

export type InsightsSubjectRef = InsightsSubjectScope;

export function AppShell(props: AppShellProps = {}) {
  return (
    <ModelCatalogProvider>
      <AppShellView {...props} />
    </ModelCatalogProvider>
  );
}

function AppShellView({ analyticsView }: AppShellProps = {}) {
  const { theme: appearanceTheme } = useTheme();
  const authSession = useAuthSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const asUserParam = searchParams.get("asUser");
  const asUserLabelParam = searchParams.get("label");
  const isAnalytics = Boolean(analyticsView);
  const settingsIsAdmin =
    !authSession
    || authSession.role === "super_admin"
    || authSession.role === "admin";
  const settingsActorRole =
    authSession?.role === "super_admin" || authSession?.role === "admin" || authSession?.role === "member"
      ? authSession.role
      : ("owner" as const);
  const defaultSettingsSection: SettingsSection =
    settingsIsAdmin
      ? "admin"
      : "overview";

  // ── core state ──────────────────────────────────────────────────────────────
  const [activeNav, setActiveNav] = useState<NavId>("thread");
  const [insightsTabOrder, setInsightsTabOrder] = useInsightsTabOrder();
  const [insightsTab, setInsightsTab] = useState<InsightsTabId>("context");
  const [featureOrder, setFeatureOrder] = useWorkspaceFeatureOrder();
  const [settingsSection, setSettingsSectionState] = useState<SettingsSection>(() => defaultSettingsSection);
  const settingsReturnSectionRef = useRef<SettingsSection | null>(null);
  const lastWorkNavRef = useRef<NavId>("thread");
  const [settingsAnimatingOut, setSettingsAnimatingOut] = useState(false);
  const [settingsEntering, setSettingsEntering] = useState(false);

  const setSettingsSection = useCallback((section: SettingsSection) => {
    setSettingsSectionState(section);
    try { localStorage.setItem(SETTINGS_SECTION_KEY, section); } catch { /* quota */ }
  }, []);

  /**
   * When true, the Settings sheet is hidden. Dashboards must not force it open —
   * only an explicit Settings prompt (toggle / section nav) opens it.
   * Start collapsed on analytics so a remount never flashes the sheet open.
   */
  const [settingsMenuCollapsed, setSettingsMenuCollapsed] = useState(
    () => Boolean(analyticsView),
  );

  /** Leave /analytics/* and land on Settings for `section` (survives AppShell remount). */
  const returnToSettingsSection = useCallback((section: SettingsSection) => {
    stashInsightsSubject(null);
    try {
      localStorage.setItem(SETTINGS_SECTION_KEY, section);
      sessionStorage.setItem(OPEN_SETTINGS_KEY, section);
    } catch { /* quota */ }
    router.push(`/?settings=${encodeURIComponent(section)}`);
  }, [router]);

  const openSettings = useCallback((section?: SettingsSection) => {
    // Insights dashboards own the center pane — opening a Settings section
    // must leave /analytics/* or the editor never appears (only the left nav).
    if (analyticsView) {
      returnToSettingsSection(section ?? "overview");
      return;
    }
    if (
      activeNav !== "settings"
      && activeNav !== "security-dashboard"
    ) {
      lastWorkNavRef.current = activeNav;
    }
    if (section) setSettingsSection(section);
    else if (settingsIsAdmin && settingsSection === "overview") setSettingsSection(defaultSettingsSection);
    setSettingsMenuCollapsed(false);
    setActiveNav("settings");
  }, [
    activeNav,
    analyticsView,
    defaultSettingsSection,
    returnToSettingsSection,
    setSettingsSection,
    settingsIsAdmin,
    settingsSection,
  ]);

  const closeSettings = useCallback(() => {
    // Don't clobber a nav change that already left Settings (e.g. workspace click).
    setActiveNav(prev => {
      if (prev !== "settings" && prev !== "security-dashboard") return prev;
      const dest = lastWorkNavRef.current;
      return dest === "settings" || dest === "security-dashboard" ? "thread" : dest;
    });
  }, []);

  /** Animated leave Settings / analytics entirely — used by the Settings toggle. */
  const dismissSettings = useCallback(() => {
    if (settingsAnimatingOut) return;
    if (activeNav !== "settings" && !analyticsView) return;
    setSettingsAnimatingOut(true);
    window.setTimeout(() => {
      if (analyticsView) {
        stashInsightsSubject(null);
        router.push("/");
      }
      closeSettings();
      setSettingsMenuCollapsed(false);
      setSettingsAnimatingOut(false);
    }, SETTINGS_TRANSITION_MS);
  }, [activeNav, analyticsView, closeSettings, router, settingsAnimatingOut]);

  /**
   * Hide the Settings sheet on outside click — stay on the current page
   * (Settings hub or analytics). The Settings toggle still exits entirely.
   */
  const dismissSettingsMenu = useCallback(() => {
    if (settingsAnimatingOut || settingsMenuCollapsed) return;
    if (activeNav !== "settings" && !analyticsView) return;
    setSettingsMenuCollapsed(true);
  }, [
    activeNav,
    analyticsView,
    settingsAnimatingOut,
    settingsMenuCollapsed,
  ]);

  const toggleSettings = useCallback(() => {
    // Analytics: toggle sheet only — do not leave the dashboard.
    if (analyticsView) {
      setSettingsMenuCollapsed(prev => !prev);
      return;
    }
    if (activeNav === "settings") {
      if (settingsMenuCollapsed) {
        setSettingsMenuCollapsed(false);
        return;
      }
      dismissSettings();
      return;
    }
    openSettings();
  }, [activeNav, analyticsView, dismissSettings, openSettings, settingsMenuCollapsed]);

  const settingsChromeRef = useRef<HTMLDivElement>(null);

  // Any pointerdown outside the Settings sheet + toggle collapses the menu.
  useEffect(() => {
    const sheetOpen =
      (activeNav === "settings" || Boolean(analyticsView))
      && !settingsAnimatingOut
      && !settingsMenuCollapsed;
    if (!sheetOpen) return;

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (settingsChromeRef.current?.contains(target)) return;
      dismissSettingsMenu();
    };

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [
    activeNav,
    analyticsView,
    dismissSettingsMenu,
    settingsAnimatingOut,
    settingsMenuCollapsed,
  ]);

  /** Non-dashboard Settings sections (Overview / Workspace / Inference). */
  const handleSettingsSectionChange = useCallback((section: SettingsSection) => {
    setSettingsMenuCollapsed(false);
    if (analyticsView) {
      returnToSettingsSection(section);
      return;
    }
    setSettingsSection(section);
    setActiveNav("settings");
  }, [analyticsView, returnToSettingsSection, setSettingsSection]);

  // Deep link: /?settings=admin (and session fallback) after leaving analytics.
  const consumedSettingsDeepLink = useRef(false);
  useEffect(() => {
    if (analyticsView || consumedSettingsDeepLink.current) return;
    const fromQuery = searchParams.get("settings");
    let section = fromQuery;
    if (!section) {
      try {
        section = sessionStorage.getItem(OPEN_SETTINGS_KEY);
        if (section) sessionStorage.removeItem(OPEN_SETTINGS_KEY);
      } catch { /* ignore */ }
    }
    if (!section || !isSettingsSection(section)) return;
    consumedSettingsDeepLink.current = true;
    if (searchParams.get("highlight") === "bedrock") markBedrockHighlight();
    setSettingsSectionState(section);
    try { localStorage.setItem(SETTINGS_SECTION_KEY, section); } catch { /* quota */ }
    setActiveNav("settings");
    if (fromQuery) router.replace("/", { scroll: false });
  }, [analyticsView, searchParams, router]);

  useEffect(() => {
    const sheetShouldEnter =
      (activeNav === "settings" || Boolean(analyticsView))
      && !settingsMenuCollapsed
      && !settingsAnimatingOut;
    if (sheetShouldEnter) {
      setSettingsEntering(true);
      const id = requestAnimationFrame(() => {
        requestAnimationFrame(() => setSettingsEntering(false));
      });
      return () => cancelAnimationFrame(id);
    }
    setSettingsEntering(false);
  }, [activeNav, analyticsView, settingsAnimatingOut, settingsMenuCollapsed]);

  // Opening a full Insights dashboard must not drag the Settings sheet open with it.
  useEffect(() => {
    if (analyticsView) setSettingsMenuCollapsed(true);
  }, [analyticsView]);

  const openInsightsDashboard = useCallback((
    view: InsightsDashboard,
    subject?: InsightsSubjectRef | null | string,
  ) => {
    setSettingsMenuCollapsed(true);
    const hash =
      typeof subject === "string"
        ? (subject.startsWith("#") ? subject : `#${subject}`)
        : "";
    const subjectRef = typeof subject === "string" ? null : subject;
    if (subjectRef?.userId) {
      stashInsightsSubject(subjectRef);
      const params = new URLSearchParams({ asUser: subjectRef.userId });
      if (subjectRef.label) params.set("label", subjectRef.label);
      router.push(`/analytics/${view}?${params.toString()}${hash}`);
      return;
    }
    stashInsightsSubject(null);
    router.push(`/analytics/${view}${hash}`);
  }, [router]);

  const [insightsSubject, setInsightsSubject] = useState<InsightsSubjectScope | null>(null);
  const [subjectWorkspaces, setSubjectWorkspaces] = useState<{ id: string; name: string }[]>([]);
  const insightsReadyUserRef = useRef<string | null>(null);

  // Resolve admin subject from URL (preferred) or session stash; enrich via API.
  useEffect(() => {
    if (!analyticsView) {
      setInsightsSubject(null);
      setSubjectWorkspaces([]);
      insightsReadyUserRef.current = null;
      return;
    }

    const stashed = readStashedInsightsSubject();
    const userId = asUserParam ?? stashed?.userId ?? null;
    if (!userId) {
      stashInsightsSubject(null);
      setInsightsSubject(null);
      setSubjectWorkspaces([]);
      insightsReadyUserRef.current = null;
      return;
    }

    const seedLabel =
      asUserLabelParam?.trim()
      || (stashed?.userId === userId ? stashed.label : null)
      || (userId === "local" ? "Local user" : `${userId.slice(0, 12)}…`);
    const seedEmail = stashed?.userId === userId ? stashed.email : null;
    const seed: InsightsSubjectScope = {
      userId,
      label: seedLabel,
      email: seedEmail,
    };
    setInsightsSubject(seed);
    stashInsightsSubject(seed);

    // If the URL lost asUser but stash has it, put it back so tabs/API stay scoped.
    if (!asUserParam && typeof window !== "undefined") {
      const params = new URLSearchParams({ asUser: userId });
      if (seed.label) params.set("label", seed.label);
      router.replace(`/analytics/${analyticsView}?${params.toString()}`);
    }

    if (insightsReadyUserRef.current === userId) return;

    const ac = new AbortController();
    void (async () => {
      try {
        const res = await fetch(
          `/api/admin/insights-subject?userId=${encodeURIComponent(userId)}`,
          { credentials: "same-origin", signal: ac.signal },
        );
        if (ac.signal.aborted) return;
        if (!res.ok) {
          // Keep seed label — do not clear the banner on API failure.
          setSubjectWorkspaces([]);
          return;
        }
        const meta = (await res.json()) as {
          userId: string;
          label: string;
          email: string | null;
          workspaces: { id: string; name: string }[];
        };
        const next: InsightsSubjectScope = {
          userId: meta.userId,
          label: meta.label,
          email: meta.email,
        };
        setInsightsSubject(next);
        stashInsightsSubject(next);
        setSubjectWorkspaces(meta.workspaces ?? []);
        insightsReadyUserRef.current = userId;
      } catch {
        if (!ac.signal.aborted) setSubjectWorkspaces([]);
      }
    })();
    return () => {
      ac.abort();
    };
  }, [analyticsView, asUserParam, asUserLabelParam, router]);

  const backToAdminFromInsights = useCallback(() => {
    returnToSettingsSection("admin");
  }, [returnToSettingsSection]);

  // Full Insights dashboards live under Settings for section highlighting when
  // the sheet is opened — the sheet itself stays collapsed unless prompted.
  // Admin drill-down keeps Admin console highlighted in the nav.
  useEffect(() => {
    if (!analyticsView) return;
    setActiveNav("settings");
    const scoped = Boolean(asUserParam || readStashedInsightsSubject()?.userId);
    if (scoped) {
      setSettingsSectionState("admin");
      return;
    }
    if (analyticsView === "usage") setSettingsSectionState("insights-context");
    else if (analyticsView === "cost") setSettingsSectionState("insights-savings");
    else setSettingsSectionState("insights-security");
  }, [analyticsView, asUserParam]);

  const [mode, setMode]           = useState<Mode>("Standard" as Mode);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [streamStartedAt, setStreamStartedAt] = useState<number | null>(null);
  /** Groq key present but Settings → Inference vendor consent unchecked. */
  const [vendorRiskBlocked, setVendorRiskBlocked] = useState(false);
  const [vendorHasGroq, setVendorHasGroq] = useState(false);
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatusPayload | null>(null);
  const runtimeStatusRef = useRef<RuntimeStatusPayload | null>(null);

  const refreshRuntimeStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/runtime/status", { credentials: "same-origin" });
      if (!res.ok) return null;
      const data = (await res.json()) as RuntimeStatusPayload;
      runtimeStatusRef.current = data;
      setRuntimeStatus(data);
      return data;
    } catch {
      return null;
    }
  }, []);

  const refreshVendorRiskBanner = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/providers?lite=1", { credentials: "same-origin" });
      if (!res.ok) return;
      const data = (await res.json()) as {
        hasGroqKey?: boolean;
        hasEnvGroqKey?: boolean;
        externalRiskAckAt?: string | null;
      };
      const hasKey = Boolean(data.hasGroqKey || data.hasEnvGroqKey);
      setVendorHasGroq(hasKey);
      setVendorRiskBlocked(hasKey && !data.externalRiskAckAt);
    } catch {
      /* ignore — banner is advisory */
    }
  }, []);

  // Lite flags only (no AWS probe). Skip while Settings is open — re-check on leave.
  useEffect(() => {
    if (activeNav === "settings") return;
    void refreshVendorRiskBanner();
  }, [activeNav, refreshVendorRiskBanner]);

  useEffect(() => {
    void refreshRuntimeStatus();
  }, [refreshRuntimeStatus]);

  useEffect(() => {
    if (activeNav === "settings") return;
    void refreshRuntimeStatus();
  }, [activeNav, refreshRuntimeStatus]);

  // ── voice input state ───────────────────────────────────────────────────────
  const [voiceState, setVoiceState]   = useState<"idle" | "requesting" | "listening" | "transcribing">("idle");
  const [voiceSetupOpen, setVoiceSetupOpen] = useState(false);
  const [waveHistory, setWaveHistory] = useState<number[]>(Array(80).fill(0.03));
  const [voiceElapsed, setVoiceElapsed] = useState(0);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [liveText, setLiveText] = useState({ final: "", interim: "" });
  const [previewPending, setPreviewPending] = useState(false);
  const voiceStateRef   = useRef<"idle" | "requesting" | "listening" | "transcribing">("idle");
  const mediaStreamRef  = useRef<MediaStream | null>(null);
  const mediaRecRef     = useRef<MediaRecorder | null>(null);
  const audioChunksRef  = useRef<Blob[]>([]);
  const audioCtxRef     = useRef<AudioContext | null>(null);
  const analyserRef     = useRef<AnalyserNode | null>(null);
  const animFrameRef    = useRef<number>(0);
  const composerDraftRef = useRef<Pick<ComposerVoiceInsert, "base" | "selectionStart" | "selectionEnd">>({
    base: "",
    selectionStart: 0,
    selectionEnd: 0,
  });
  const [voiceComposerInsert, setVoiceComposerInsert] = useState<ComposerVoiceInsert | null>(null);
  const transcribeAbortRef = useRef<AbortController | null>(null);
  const transcribeCancelledRef = useRef(false);
  const liveTextRef = useRef({ final: "", interim: "" });
  const previewIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const previewDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewBusyRef = useRef(false);
  const lastPreviewBytesRef = useRef(0);
  const runLivePreviewRef = useRef<() => void>(() => {});
  const cloudLiveRef = useRef<CloudLiveSttHandle | null>(null);
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
  /** Server cost summary for Insights → Cost (same source as /analytics/cost). */
  const [serverCost, setServerCost] = useState<InsightsCostPayload | null>(null);
  const [serverCostLoading, setServerCostLoading] = useState(false);
  const [piiArchive, setPiiArchive]           = useState<SessionScrubEntry[]>([]);
  const [piiSensitivity, setPiiSensitivityState] = useState<PiiSensitivityTier>(DEFAULT_SENSITIVITY);
  const [safeTerms, setSafeTerms]             = useState<SafeTerm[]>(DEFAULT_SAFE_TERMS);
  const [canEditSecurity, setCanEditSecurity] = useState(false);
  const [securityPending, setSecurityPending] = useState<null | {
    piiSensitivity: PiiSensitivityTier;
    note: string | null;
    stricterThanActive: boolean;
  }>(null);
  const [securityNotice, setSecurityNotice] = useState<string | null>(null);
  const [pendingSend, setPendingSend]         = useState<PendingSend | null>(null);
  const [openWorkspacePickerId, setOpenWorkspacePickerId] = useState<string | null>(null);
  const [deleteConfirmWorkspace, setDeleteConfirmWorkspace] = useState<Workspace | null>(null);
  const [deleteWithBackup, setDeleteWithBackup]     = useState(true);
  const [deleteBusy, setDeleteBusy]                 = useState(false);
  const [dismissedPiiIds, setDismissedPiiIds]       = useState<Set<string>>(new Set());
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
  const [workspaceListError, setWorkspaceListError] = useState<string | null>(null);
  const [workspacesReady, setWorkspacesReady]     = useState(false);
  const workspaceIds = useMemo(() => workspaces.map(w => w.id), [workspaces]);
  const [workspaceListOrder, setWorkspaceListOrder] = useWorkspaceListOrder(workspaceIds);
  const orderedWorkspaces = useMemo(() => {
    const byId = new Map(workspaces.map(w => [w.id, w]));
    return workspaceListOrder
      .map(id => byId.get(id))
      .filter((w): w is Workspace => Boolean(w));
  }, [workspaces, workspaceListOrder]);
  const [dragWorkspaceId, setDragWorkspaceId] = useState<string | null>(null);
  const [workspaceDropIndex, setWorkspaceDropIndex] = useState<number | null>(null);
  const workspaceDropIndexRef = useRef<number | null>(null);
  const suppressWorkspaceClick = useRef(false);
  const workspaceRowRefs = useRef<Record<string, HTMLElement | null>>({});
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

  // ── resizable sidebars ──────────────────────────────────────────────────────
  const leftSidebar = useSidebarWidth(
    LEFT_SIDEBAR_KEY,
    LEFT_SIDEBAR_DEFAULT,
    LEFT_SIDEBAR_MIN,
    LEFT_SIDEBAR_MAX,
  );
  const rightSidebar = useSidebarWidth(
    RIGHT_SIDEBAR_KEY,
    RIGHT_SIDEBAR_DEFAULT,
    RIGHT_SIDEBAR_MIN,
    RIGHT_SIDEBAR_MAX,
  );
  const settingsNavHeight = useResizableHeight(
    SETTINGS_NAV_HEIGHT_KEY,
    SETTINGS_NAV_HEIGHT_DEFAULT,
    SETTINGS_NAV_HEIGHT_MIN,
    SETTINGS_NAV_HEIGHT_MAX,
  );
  const settingsNavContentRef = useRef<HTMLDivElement>(null);
  const settingsNavExpandedForMeasure =
    (activeNav === "settings" || Boolean(analyticsView))
    && !settingsAnimatingOut
    && !settingsEntering
    && !settingsMenuCollapsed;
  // Grow the Settings stack so every section is visible without scrolling
  // (still capped at SETTINGS_NAV_HEIGHT_MAX; user can drag taller/shorter).
  useEffect(() => {
    if (!settingsNavExpandedForMeasure || settingsNavHeight.dragging) return;
    const el = settingsNavContentRef.current;
    if (!el) return;
    const needed = Math.ceil(el.scrollHeight + 8);
    const next = Math.min(
      SETTINGS_NAV_HEIGHT_MAX,
      Math.max(SETTINGS_NAV_HEIGHT_MIN, needed),
    );
    if (next > settingsNavHeight.height) {
      settingsNavHeight.setHeight(next);
    }
  }, [
    settingsNavExpandedForMeasure,
    settingsNavHeight.dragging,
    settingsNavHeight.height,
    settingsNavHeight.setHeight,
    settingsIsAdmin,
  ]);

  // ── intel panel + model overrides ───────────────────────────────────────────
  const [isIntelOpen,       setIsIntelOpen]       = useState(!analyticsView);

  useEffect(() => {
    if (isAnalytics) setIsIntelOpen(false);
  }, [isAnalytics]);

  // Live vendor lists load when the user opens a picker — not on every page load.
  const { catalog, byId: catalogById, ensureLoaded, loaded: catalogLoaded } = useModelCatalog();
  const chatCatalogModels = useMemo(() => buildChatPickerModels(catalog), [catalog]);
  const pickerById = useCallback(
    (id: string) => chatCatalogModels.find(m => m.id === id) ?? catalogById(id),
    [chatCatalogModels, catalogById],
  );
  const groqListed = catalog.groq.length > 0;
  const groqCatalogReady = groqListed;
  const ollamaCatalogReady = chatCatalogModels.some(m => m.provider === "ollama");
  const bedrockCatalogReady = catalog.bedrock.length > 0;
  const openaiCatalogReady = catalog.openai.length > 0;
  const anthropicCatalogReady = catalog.anthropic.length > 0;
  const googleCatalogReady = catalog.google.length > 0;
  const xaiCatalogReady = (catalog.xai ?? []).length > 0;
  const cloudDefaultsWillRun = groqListed && !vendorRiskBlocked;
  const localFallbackModel =
    runtimeStatus?.model.provider === "ollama" ? runtimeStatus.model.model : null;
  const labelFor = useCallback(
    (id: string) => {
      const hit = pickerById(id);
      if (hit) return modelDisplayName(hit);
      return SELECTABLE_MODELS.find(m => m.id === id)?.label ?? shortModelName(id);
    },
    [pickerById],
  );
  const providerFor = useCallback(
    (id: string) => pickerById(id)?.provider ?? guessProvider(id),
    [pickerById],
  );
  const tierProviderReady = useCallback(
    (provider: ReturnType<typeof providerFor>, modelId: string) => {
      if (!provider) return false;
      const hit = pickerById(modelId);
      if (hit) return !isReferenceOnlyModel(hit) && catalogSelectionStatus(hit).ready;
      if (provider === "groq") return groqCatalogReady;
      if (provider === "ollama") return ollamaCatalogReady;
      if (provider === "openai") return openaiCatalogReady;
      if (provider === "anthropic") return anthropicCatalogReady;
      if (provider === "google") return googleCatalogReady;
      if (provider === "xai") return xaiCatalogReady;
      return catalog.bedrock.length > 0;
    },
    [
      anthropicCatalogReady,
      catalog.bedrock.length,
      googleCatalogReady,
      groqCatalogReady,
      xaiCatalogReady,
      ollamaCatalogReady,
      openaiCatalogReady,
      pickerById,
    ],
  );

  const canRunAssignedModel = useCallback((modelId: string) => {
    const provider = guessProvider(modelId);
    if (!catalogLoaded) return provider !== "groq";
    const hit = pickerById(modelId);
    if (hit?.provider === "groq") return hit.modality !== "other";
    if (hit) return !isReferenceOnlyModel(hit) && isChatSelectableModel(hit);
    if (provider === "ollama") return ollamaCatalogReady;
    if (provider === "openai") return openaiCatalogReady;
    if (provider === "anthropic") return anthropicCatalogReady;
    if (provider === "google") return googleCatalogReady;
    if (provider === "xai") return xaiCatalogReady;
    if (provider === "bedrock") return bedrockCatalogReady;
    return false;
  }, [
    anthropicCatalogReady,
    bedrockCatalogReady,
    catalogLoaded,
    googleCatalogReady,
    ollamaCatalogReady,
    openaiCatalogReady,
    pickerById,
    xaiCatalogReady,
  ]);

  const [modeModelOverrides, setModeModelOverrides] = useState<Record<string, string>>({});
  const [modelSelectionMode, setModelSelectionMode] = useState<"auto" | "fixed">("auto");
  const [fixedModelId,       setFixedModelId]       = useState("openai/gpt-oss-120b");
  const [tierPrefsReady,     setTierPrefsReady]     = useState(false);
  const [changedTiers, setChangedTiers] = useState<Record<string, number>>({});
  const [savingsBaselineModel, setSavingsBaselineModel] = useState(DEFAULT_SAVINGS_BASELINE);
  const savingsBaselineModelRef = useRef(DEFAULT_SAVINGS_BASELINE);

  const markTierChanged = useCallback((tier: string) => {
    const token = Date.now();
    setChangedTiers(prev => ({ ...prev, [tier]: token }));
    window.setTimeout(() => {
      setChangedTiers(prev => {
        if (prev[tier] !== token) return prev;
        const next = { ...prev };
        delete next[tier];
        return next;
      });
    }, TIER_CHANGED_FLASH_MS);
  }, []);

  const assignTierModel = useCallback((tier: string, modelId: string | null) => {
    setModeModelOverrides(prev => {
      const next = { ...prev };
      if (!modelId) delete next[tier];
      else next[tier] = modelId;
      return next;
    });
    markTierChanged(tier);
  }, [markTierChanged]);

  useEffect(() => {
    try {
      setModeModelOverrides(parseTierModelOverrides(localStorage.getItem(TIER_MODEL_OVERRIDES_KEY)));
      const storedSelectionMode = localStorage.getItem(MODEL_SELECTION_MODE_KEY);
      if (storedSelectionMode === "fixed") setModelSelectionMode("fixed");
      const storedFixed = localStorage.getItem(FIXED_MODEL_ID_KEY)?.trim();
      if (storedFixed) setFixedModelId(storedFixed);
    } catch { /* private browsing */ }
    setTierPrefsReady(true);
  }, []);

  useEffect(() => {
    if (vendorHasGroq || localFallbackModel || modelSelectionMode === "fixed" || Object.keys(modeModelOverrides).length > 0) {
      void ensureLoaded();
    }
  }, [vendorHasGroq, localFallbackModel, modelSelectionMode, modeModelOverrides, ensureLoaded]);

  useEffect(() => {
    if (!tierPrefsReady) return;
    try {
      localStorage.setItem(TIER_MODEL_OVERRIDES_KEY, JSON.stringify(sanitizeTierOverrides(modeModelOverrides)));
    } catch { /* quota */ }
  }, [tierPrefsReady, modeModelOverrides]);

  useEffect(() => {
    if (!tierPrefsReady) return;
    try {
      localStorage.setItem(MODEL_SELECTION_MODE_KEY, modelSelectionMode);
      localStorage.setItem(FIXED_MODEL_ID_KEY, fixedModelId);
    } catch { /* quota */ }
  }, [tierPrefsReady, modelSelectionMode, fixedModelId]);

  useEffect(() => { savingsBaselineModelRef.current = savingsBaselineModel; }, [savingsBaselineModel]);

  const setSavingsBaseline = useCallback((modelId: string) => {
    setSavingsBaselineModel(modelId);
    try { localStorage.setItem(SAVINGS_BASELINE_KEY, modelId); } catch { /* quota */ }
  }, []);
  const [lastRouteInfo, setLastRouteInfo] = useState<RouteInfo | null>(null);
  const postedModelOverrides = useMemo(
    () =>
      effectiveTierOverrides({
        selectionMode: modelSelectionMode,
        fixedModelId,
        overrides: modeModelOverrides,
        cloudDefaultsWillRun,
        canRun: canRunAssignedModel,
      }),
    [canRunAssignedModel, cloudDefaultsWillRun, fixedModelId, modeModelOverrides, modelSelectionMode],
  );
  const displayModelIdForTier = useCallback(
    (tier: string) =>
      displayModelForTier({
        tier,
        overrides: modeModelOverrides,
        cloudDefaultsWillRun,
        localFallbackModel,
        canRun: canRunAssignedModel,
      }),
    [canRunAssignedModel, cloudDefaultsWillRun, localFallbackModel, modeModelOverrides],
  );

  const tierModelStatus = useCallback(
    (modelId: string) => {
      const catalog = pickerById(modelId);
      if (catalog && isChatUsableModelId(modelId)) return catalogSelectionStatus(catalog);
      const notForChat = !isChatUsableModelId(modelId);
      const provider = providerFor(modelId);
      return {
        notForChat,
        ready: notForChat ? false : tierProviderReady(provider, modelId),
      };
    },
    [pickerById, providerFor, tierProviderReady],
  );

  const composerInUseLabel = useMemo(() => {
    if (lastRouteInfo) {
      return `Last reply · ${lastRouteInfo.provider} · ${lastRouteInfo.model}`;
    }
    if (modelSelectionMode === "fixed") {
      const p = guessProvider(fixedModelId);
      return `Every message · ${p ?? "model"} · ${fixedModelId}`;
    }
    if (Object.keys(modeModelOverrides).length > 0) {
      return "Auto by complexity · assigned models";
    }
    if (cloudDefaultsWillRun) {
      return "Auto by complexity · assigned models";
    }
    if (runtimeStatus?.model.provider) {
      return `Ready · ${runtimeStatus.model.provider}${
        runtimeStatus.model.model ? ` · ${runtimeStatus.model.model}` : ""
      }`;
    }
    return null;
  }, [
    cloudDefaultsWillRun,
    fixedModelId,
    lastRouteInfo,
    modeModelOverrides,
    modelSelectionMode,
    runtimeStatus?.model.model,
    runtimeStatus?.model.provider,
  ]);
  const composerInUseProvider = useMemo(() => {
    if (lastRouteInfo) return lastRouteInfo.provider;
    if (modelSelectionMode === "fixed") return guessProvider(fixedModelId);
    if (runtimeStatus?.model.provider) return runtimeStatus.model.provider;
    return null;
  }, [
    fixedModelId,
    lastRouteInfo,
    modelSelectionMode,
    runtimeStatus?.model.provider,
  ]);

  // ── memory state ─────────────────────────────────────────────────────────────
  const [sessionSummary, setSessionSummary]   = useState("");
  const [extractedFacts, setExtractedFacts]   = useState<Record<string, string>>({});
  const [summarizedCount, setSummarizedCount] = useState(0);

  // Full memory view — fetched from DB when the Memory tab opens
  const [workspaceFacts,         setWorkspaceFacts]         = useState<WorkspaceFactRecord[]>([]);
  const [allSessionSummaries, setAllSessionSummaries] = useState<SessionSummaryRecord[]>([]);
  const [memoryStats,        setMemoryStats]        = useState<{ semanticFragmentCount: number; documentFragmentCount: number } | null>(null);
  const [memoryLoading,      setMemoryLoading]       = useState(false);

  // Refs for access inside callbacks without stale closures
  const sessionSummaryRef  = useRef("");
  const extractedFactsRef  = useRef<Record<string, string>>({});
  const summarizedCountRef = useRef(0);
  const factExtractInFlightRef = useRef(false);
  const lastFactExtractUserCountRef = useRef(-1);
  const messagesRef        = useRef<ChatMessage[]>([]);
  const loadedWorkspaceRef     = useRef<string | null>(null);

  useEffect(() => { sessionSummaryRef.current  = sessionSummary;  }, [sessionSummary]);
  useEffect(() => { extractedFactsRef.current  = extractedFacts;  }, [extractedFacts]);
  useEffect(() => { summarizedCountRef.current = summarizedCount; }, [summarizedCount]);
  useEffect(() => { messagesRef.current        = messages;        }, [messages]);
  useEffect(() => {
    if (!isStreaming && activeWorkspaceId && messages.length > 0) {
      writeCachedMessages(activeWorkspaceId, messages);
    }
  }, [messages, activeWorkspaceId, isStreaming]);
  useEffect(() => {
    activeNavRef.current = activeNav;
    // Clear the unseen badge the moment the user opens Bookmarks
    if (activeNav === "bookmarks") setUnseenBookmarkIds(new Set());
  }, [activeNav]);

  // Sync expanded agent to match the active agent whenever it changes
  useEffect(() => {
    if (activeWorkspaceId) setExpandedWorkspaceId(activeWorkspaceId);
  }, [activeWorkspaceId]);

  // ── bookmark server persistence (migrates leftover localStorage once) ────────
  useEffect(() => {
    if (!activeWorkspaceId) return;
    let cancelled = false;
    const localKey = `sm_bm_${activeWorkspaceId}`;
    (async () => {
      try {
        const res = await fetch(`/api/bookmarks?workspaceId=${activeWorkspaceId}`);
        if (!res.ok) return;
        let items = (await res.json() as { items?: BookmarkEntry[] }).items ?? [];
        if (items.length === 0) {
          const stored = localStorage.getItem(localKey);
          if (stored) {
            const parsed = JSON.parse(stored) as BookmarkEntry[];
            const migrated = await fetch("/api/bookmarks", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                workspaceId: activeWorkspaceId,
                migrate: true,
                items: parsed,
              }),
            });
            if (migrated.ok) {
              items = (await migrated.json() as { items?: BookmarkEntry[] }).items ?? parsed;
              localStorage.removeItem(localKey);
            }
          }
        } else {
          try { localStorage.removeItem(localKey); } catch { /* ignore */ }
        }
        if (cancelled) return;
        setBookmarks(items);
        setMessages(prev => prev.map(m => ({
          ...m,
          bookmarked: items.some(b => b.messageId === m.id),
        })));
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId]);

  // ── memory fetch ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (activeNav !== "memory" || !viewWorkspaceId) return;
    const ac = new AbortController();
    setMemoryLoading(true);
    fetch(`/api/memory?workspaceId=${viewWorkspaceId}`, { signal: ac.signal })
      .then(r => r.json())
      .then(data => {
        if (ac.signal.aborted) return;
        setWorkspaceFacts(data.workspaceFacts ?? []);
        setAllSessionSummaries(data.sessionSummaries ?? []);
        setMemoryStats(data.stats ?? null);
      })
      .catch(() => { /* silently ignore — in-session data is still shown */ })
      .finally(() => { setMemoryLoading(false); });
    return () => ac.abort();
  }, [activeNav, viewWorkspaceId]);

  // ── view bookmarks (per workspace) ──────────────────────────────────────────
  useEffect(() => {
    if (activeNav !== "bookmarks" || !viewWorkspaceId) return;
    fetch(`/api/bookmarks?workspaceId=${viewWorkspaceId}`)
      .then(r => r.ok ? r.json() : { items: [] })
      .then((data: { items?: BookmarkEntry[] }) => setViewBookmarks(data.items ?? []))
      .catch(() => setViewBookmarks([]));
  }, [activeNav, viewWorkspaceId]);

  useEffect(() => { viewWorkspaceIdRef.current = viewWorkspaceId; }, [viewWorkspaceId]);

  // Load persisted routing + PII history; hydrate security policy from server
  useEffect(() => {
    // Must run before the archive is read so no legacy raw value reaches state.
    purgeLegacyPiiValues();
    sweepOrphanedStorageKeys();
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
      // localStorage is a cache only — server InstanceConfig is source of truth when available
      const sensitivity = localStorage.getItem(PII_SENSITIVITY_KEY);
      const parsed = parsePiiSensitivityTier(sensitivity);
      if (parsed) {
        setPiiSensitivityState(parsed);
      }
      const storedTerms = localStorage.getItem(SAFE_TERMS_KEY);
      if (storedTerms) setSafeTerms(omitRetiredDefaultSafeTerms(JSON.parse(storedTerms) as SafeTerm[]));
      const dismissed = localStorage.getItem(PII_DISMISSED_KEY);
      if (dismissed) setDismissedPiiIds(new Set(JSON.parse(dismissed) as string[]));
      const baseline = localStorage.getItem(SAVINGS_BASELINE_KEY);
      if (baseline && GROQ_MODEL_PRICING[baseline]) setSavingsBaselineModel(baseline);
      const savedSettingsSection = localStorage.getItem(SETTINGS_SECTION_KEY);
      if (savedSettingsSection && isSettingsSection(savedSettingsSection)) {
        setSettingsSectionState(savedSettingsSection);
      } else {
        setSettingsSectionState(defaultSettingsSection);
      }
    } catch { /* ignore malformed storage */ }

    void (async () => {
      try {
        const res = await fetch("/api/settings/security");
        if (!res.ok) return;
        const data = await res.json() as {
          piiSensitivity?: PiiSensitivityTier;
          safeTerms?: SafeTerm[];
          canEdit?: boolean;
          pending?: null | {
            piiSensitivity: PiiSensitivityTier;
            note: string | null;
            stricterThanActive: boolean;
          };
        };
        if (data.piiSensitivity) {
          const parsed = parsePiiSensitivityTier(data.piiSensitivity) ?? data.piiSensitivity;
          setPiiSensitivityState(parsed);
          try { localStorage.setItem(PII_SENSITIVITY_KEY, parsed); } catch { /* quota */ }
        }
        if (Array.isArray(data.safeTerms)) {
          const terms = omitRetiredDefaultSafeTerms(
            data.safeTerms.length ? data.safeTerms : DEFAULT_SAFE_TERMS,
          );
          setSafeTerms(terms);
          persistSafeTerms(terms);
        }
        setCanEditSecurity(Boolean(data.canEdit));
        setSecurityPending(data.pending ?? null);
      } catch { /* offline / first boot */ }
    })();
  }, [defaultSettingsSection]);

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
  const [knowledgeFilter, setKnowledgeFilter] = useState<KnowledgeLibraryFilter>("all");
  const [docDragOver,   setDocDragOver]   = useState(false);
  const docFileRef = useRef<HTMLInputElement>(null);
  const docDragCounterRef = useRef(0);

  const bottomRef    = useRef<HTMLDivElement>(null);
  /** When true, keep the thread pinned to the latest tokens (ChatGPT-style). */
  const stickToBottomRef = useRef(true);
  const streamScrollRafRef = useRef<number | null>(null);
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
  const sendInFlightRef = useRef(false);
  const [sendInFlight, setSendInFlight] = useState(false);
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
  const streamReaderRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);
  const docsAbortRef = useRef<AbortController | null>(null);
  const pollTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const pollAttemptsRef = useRef(new Map<string, number>());

  // ── Load workspaces then session on mount ────────────────────────────────────────
  useEffect(() => {
    fetch("/api/workspaces")
      .then(async r => {
        const data: unknown = await r.json().catch(() => null);
        if (!r.ok || !Array.isArray(data)) {
          const err = data && typeof data === "object" && "error" in data
            ? String((data as { error?: unknown }).error ?? "")
            : "";
          setWorkspaceListError(err || "Could not load workspaces.");
          setWorkspaces([]);
          setSessionLoading(false);
          return;
        }
        setWorkspaceListError(null);
        setWorkspaces(data as Workspace[]);
        const savedId = typeof window !== "undefined"
          ? localStorage.getItem(ACTIVE_WORKSPACE_KEY)
          : null;
        const savedAgent = savedId ? (data as Workspace[]).find(a => a.id === savedId) : undefined;
        const target = savedAgent ?? (data as Workspace[]).find(a => a.isDefault) ?? data[0];
        if (target) {
          setActiveWorkspaceId(target.id);
          setViewWorkspaceId(target.id);
          setExpandedWorkspaceId(target.id);
          loadSession(target.id, target.name);
        } else {
          setSessionLoading(false);
        }
      })
      .catch(() => {
        setWorkspaceListError("Could not load workspaces.");
        setSessionLoading(false);
      })
      .finally(() => setWorkspacesReady(true));
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
          const loaded = data.messages.map(m => {
            const attachedFiles = m.role === "user"
              ? attachedDocumentNamesFromText(m.content)
              : [];
            return {
              id:        m.id,
              role:      m.role as "user" | "assistant",
              content:   m.content,
              createdAt: m.createdAt,
              attachedFiles: attachedFiles.length > 0 ? attachedFiles : undefined,
            };
          });
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
        lastFactExtractUserCountRef.current = -1;
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

  // Pin thread to bottom while streaming (instant scrollTop — never smooth-per-token).
  // Smooth scrollIntoView on every delta fights new layout and feels rocky.
  const pinThreadToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const el = threadRef.current;
    if (!el) return;
    if (behavior === "smooth") {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    } else {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  useEffect(() => {
    if (sessionLoading) {
      sessionLoadedRef.current = false;
      stickToBottomRef.current = true;
      return;
    }
    if (!sessionLoadedRef.current) {
      sessionLoadedRef.current = true;
      stickToBottomRef.current = true;
      pinThreadToBottom("auto");
      return;
    }
    if (!stickToBottomRef.current) return;

    if (isStreaming) {
      if (streamScrollRafRef.current != null) return;
      streamScrollRafRef.current = requestAnimationFrame(() => {
        streamScrollRafRef.current = null;
        if (stickToBottomRef.current) pinThreadToBottom("auto");
      });
      return;
    }

    pinThreadToBottom("smooth");
  }, [messages, sessionLoading, isStreaming, pinThreadToBottom]);

  useEffect(() => () => {
    if (streamScrollRafRef.current != null) {
      cancelAnimationFrame(streamScrollRafRef.current);
      streamScrollRafRef.current = null;
    }
  }, []);

  // Floating date pill + stick-to-bottom detection
  useEffect(() => {
    const container = threadRef.current;
    if (!container) return;
    const NEAR_BOTTOM_PX = 96;
    const update = () => {
      const distance =
        container.scrollHeight - container.scrollTop - container.clientHeight;
      stickToBottomRef.current = distance <= NEAR_BOTTOM_PX;

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
    void streamReaderRef.current?.cancel().catch(() => {});
    docsAbortRef.current?.abort();
    for (const timer of pollTimersRef.current.values()) clearTimeout(timer);
    pollTimersRef.current.clear();
    pollAttemptsRef.current.clear();
    mediaRecRef.current?.stop();
    mediaStreamRef.current?.getTracks().forEach(t => t.stop());
    cancelAnimationFrame(animFrameRef.current);
    audioCtxRef.current?.close().catch(() => {});
  }, []);

  // ── background memory compression ────────────────────────────────────────────
  // Fires after each streaming response. Compresses old turns into a rolling
  // summary so the context window stays small regardless of conversation length.
  const WORKING_MEMORY  = 10; // raw turns always sent verbatim
  const SUMMARIZE_EVERY = 6;  // compress when overflow exceeds this
  const MAX_SUMMARIZE_BATCH = 40;
  const summarizeInFlightRef = useRef(false);

  useEffect(() => {
    if (isStreaming) return; // wait for response to finish
    if (summarizeInFlightRef.current) return;

    const msgs      = messagesRef.current.filter(m => m.role !== "assistant" || m.content);
    const sumCount  = summarizedCountRef.current;
    const overflow  = msgs.slice(sumCount);

    if (overflow.length <= WORKING_MEMORY + SUMMARIZE_EVERY) return;

    const toSummarize = overflow.slice(0, -WORKING_MEMORY).slice(0, MAX_SUMMARIZE_BATCH);
    const newCount    = sumCount + toSummarize.length;
    summarizeInFlightRef.current = true;

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
      .catch(err => console.error("[memory] summarization failed:", err))
      .finally(() => { summarizeInFlightRef.current = false; });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStreaming]);

  // Capture user-stated facts without waiting for thread compression.
  useEffect(() => {
    if (isStreaming) return;
    if (factExtractInFlightRef.current) return;
    if (!sessionIdRef.current || !activeWorkspaceId) return;

    const msgs = messagesRef.current.filter(m => m.role !== "assistant" || m.content);
    const userCount = msgs.filter(m => m.role === "user").length;
    if (userCount === 0) return;
    if (userCount === lastFactExtractUserCountRef.current) return;

    const recent = msgs.slice(-16);
    factExtractInFlightRef.current = true;
    fetch("/api/summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        purpose: "facts",
        messages: recent.map(m => ({ role: m.role, content: m.content })),
        existingSummary: sessionSummaryRef.current,
        existingFacts: extractedFactsRef.current,
        sessionId: sessionIdRef.current,
        workspaceId: activeWorkspaceId,
      }),
    })
      .then(r => r.json() as Promise<{ summary?: string; facts?: Record<string, string> }>)
      .then(({ summary, facts }) => {
        lastFactExtractUserCountRef.current = userCount;
        if (typeof summary === "string" && summary.trim()) setSessionSummary(summary);
        if (facts && typeof facts === "object") setExtractedFacts(facts);
        if (viewWorkspaceId) {
          fetch(`/api/memory?workspaceId=${viewWorkspaceId}`)
            .then(r => r.json())
            .then(data => {
              setWorkspaceFacts(data.workspaceFacts ?? []);
              setAllSessionSummaries(data.sessionSummaries ?? []);
              setMemoryStats(data.stats ?? null);
            })
            .catch(() => { /* live facts still show */ });
        }
      })
      .catch(err => console.error("[memory] fact extract failed:", err))
      .finally(() => { factExtractInFlightRef.current = false; });
  }, [isStreaming, activeWorkspaceId, activeNav, viewWorkspaceId]);

  // ── voice input pipeline ─────────────────────────────────────────────────────
  useEffect(() => { voiceStateRef.current = voiceState; }, [voiceState]);
  useEffect(() => { liveTextRef.current = liveText; }, [liveText]);

  type VoiceState = "idle" | "requesting" | "listening" | "transcribing";
  const setVoiceStateSynced = useCallback((next: VoiceState) => {
    voiceStateRef.current = next;
    setVoiceState(next);
  }, []);

  useEffect(() => {
    if (voiceState !== "listening") return;
    setVoiceElapsed(0);
    const id = setInterval(() => setVoiceElapsed(s => s + 1), 1000);
    return () => clearInterval(id);
  }, [voiceState]);

  const teardownVoiceResources = useCallback(() => {
    cloudLiveRef.current?.abort();
    cloudLiveRef.current = null;
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

  const runLivePreview = useCallback(async () => {
    if (voiceStateRef.current !== "listening" || previewBusyRef.current) return;
    const chunks = audioChunksRef.current;
    if (chunks.length === 0) return;

    const blob = new Blob(chunks, { type: chunks[0].type || "audio/webm" });
    if (blob.size < 2000) return;
    if (blob.size - lastPreviewBytesRef.current < 1200) return;

    previewBusyRef.current = true;
    setPreviewPending(true);
    try {
      const provider = runtimeStatusRef.current?.capabilities.voiceStt?.provider;
      let payload: Blob = blob;
      let filename = "preview.webm";
      if (provider === "transcribe") {
        try {
          payload = await recordingToWav(blob);
          filename = "preview.wav";
        } catch {
          return;
        }
      }
      const fd = new FormData();
      fd.append("audio", payload, filename);
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
      /* live preview is best-effort — Done still runs a final pass */
    } finally {
      previewBusyRef.current = false;
      if (voiceStateRef.current === "listening") {
        setPreviewPending(false);
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

  const startVoice = useCallback(async () => {
    const stt = runtimeStatusRef.current?.capabilities.voiceStt;
    if (!stt?.choice || !stt.ready) {
      setVoiceSetupOpen(true);
      return;
    }
    snapshotComposerDraft();
    setVoiceError(null);
    setVoiceStateSynced("requesting");

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setVoiceError("Microphone permission was denied.");
      setVoiceStateSynced("idle");
      return;
    }
    mediaStreamRef.current = stream;
    audioChunksRef.current = [];

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
    recorder.start(100);
    mediaRecRef.current = recorder;

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

        let peak = 0;
        for (let i = 0; i < timeData.length; i++) {
          const v = Math.abs(timeData[i] - 128) / 128;
          if (v > peak) peak = v;
        }

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

    setLiveText({ final: "", interim: "" });
    setPreviewPending(false);
    const sttNow = runtimeStatusRef.current;
    const captionMode = voiceCaptionMode({
      edition: sttNow?.edition === "cloud" ? "cloud" : "local",
      provider: parseVoiceSttChoice(sttNow?.capabilities.voiceStt?.provider),
      livePcmSupported: Boolean(audioCtxRef.current) && supportsLivePcmUpload(),
    });

    if (captionMode === "pcm-stream" && audioCtxRef.current) {
      setPreviewPending(true);
      cloudLiveRef.current = startCloudLiveStt({
        ctx: audioCtxRef.current,
        stream,
        onCaption: (stable, interim) => {
          if (voiceStateRef.current !== "listening") return;
          setPreviewPending(false);
          setLiveText({ final: stable, interim });
        },
      });
    } else if (captionMode === "chunked-preview") {
      lastPreviewBytesRef.current = 0;
      setTimeout(() => { runLivePreviewRef.current(); }, 900);
      previewIntervalRef.current = setInterval(() => runLivePreviewRef.current(), 2000);
    }

    setVoiceStateSynced("listening");
  }, [snapshotComposerDraft, setVoiceStateSynced, scheduleLivePreview]);

  const cancelVoice = useCallback(() => {
    cloudLiveRef.current?.abort();
    cloudLiveRef.current = null;
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

  const confirmVoice = useCallback(async () => {
    if (voiceStateRef.current !== "listening") return;

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
    setVoiceError(null);
    setVoiceStateSynced("transcribing");
    transcribeCancelledRef.current = false;

    const live = cloudLiveRef.current;
    cloudLiveRef.current = null;

    await new Promise<void>(resolve => {
      const rec = mediaRecRef.current;
      if (!rec || rec.state === "inactive") { resolve(); return; }
      const prevStop = rec.onstop;
      rec.onstop = e => { if (typeof prevStop === "function") prevStop.call(rec, e); resolve(); };
      rec.stop();
    });
    if (transcribeCancelledRef.current) {
      live?.abort();
      return;
    }

    mediaRecRef.current = null;
    const chunks = audioChunksRef.current.slice();
    audioChunksRef.current = [];

    const snap = composerDraftRef.current;
    const previewFallback = (liveTextRef.current.final + liveTextRef.current.interim).trim();

    if (live) {
      try {
        const trimmed = (await live.finish()).trim() || previewFallback;
        mediaStreamRef.current?.getTracks().forEach(t => t.stop());
        mediaStreamRef.current = null;
        audioCtxRef.current?.close().catch(() => {});
        audioCtxRef.current = null;
        if (transcribeCancelledRef.current) return;
        setLiveText({ final: "", interim: "" });
        if (trimmed) {
          setVoiceComposerInsert({ text: trimmed, ...snap });
          setVoiceError(null);
        } else {
          restoreComposerDraft();
          setVoiceError("Nothing was transcribed. Speak a bit longer, then tap Done.");
        }
        setVoiceStateSynced("idle");
      } catch (err) {
        live.abort();
        mediaStreamRef.current?.getTracks().forEach(t => t.stop());
        mediaStreamRef.current = null;
        audioCtxRef.current?.close().catch(() => {});
        audioCtxRef.current = null;
        if (transcribeCancelledRef.current) return;
        console.error("[voice] live transcription error:", err);
        if (previewFallback) {
          setVoiceComposerInsert({ text: previewFallback, ...snap });
          setVoiceError(null);
        } else {
          restoreComposerDraft();
          setVoiceError(err instanceof Error ? err.message : "Transcription failed");
        }
        setVoiceStateSynced("idle");
      }
      return;
    }

    mediaStreamRef.current?.getTracks().forEach(t => t.stop());
    mediaStreamRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;

    if (transcribeCancelledRef.current) return;

    if (chunks.length === 0) {
      setLiveText({ final: "", interim: "" });
      restoreComposerDraft();
      setVoiceError("No audio was captured. Try again, then tap Done.");
      setVoiceStateSynced("idle");
      return;
    }

    transcribeAbortRef.current?.abort();
    const abortController = new AbortController();
    transcribeAbortRef.current = abortController;

    try {
      const raw = new Blob(chunks, { type: chunks[0].type || "audio/webm" });
      let payload: Blob = raw;
      let filename = "recording.webm";
      try {
        payload = await recordingToWav(raw);
        filename = "recording.wav";
      } catch {
        /* Groq can still take webm */
      }
      const fd = new FormData();
      fd.append("audio", payload, filename);
      const res = await fetch("/api/transcribe", {
        method: "POST",
        body: fd,
        signal: abortController.signal,
      });
      if (transcribeCancelledRef.current) return;

      const body = await res.json().catch(() => ({})) as { text?: string; error?: string };
      if (!res.ok) throw new Error(body.error || "Transcription failed");
      const trimmed = body.text?.trim() || previewFallback;
      setLiveText({ final: "", interim: "" });
      if (trimmed) {
        setVoiceComposerInsert({ text: trimmed, ...snap });
        setVoiceError(null);
      } else {
        restoreComposerDraft();
        setVoiceError("Nothing was transcribed. Speak a bit longer, then tap Done.");
      }
      setVoiceStateSynced("idle");
    } catch (err) {
      if (abortController.signal.aborted || transcribeCancelledRef.current) return;
      console.error("[voice] transcription error:", err);
      setLiveText({ final: "", interim: "" });
      if (previewFallback) {
        setVoiceComposerInsert({ text: previewFallback, ...snap });
        setVoiceError(null);
      } else {
        restoreComposerDraft();
        setVoiceError(err instanceof Error ? err.message : "Transcription failed");
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
    void streamReaderRef.current?.cancel().catch(() => {});
    streamReaderRef.current = null;
    abortRef.current?.abort();
  }, []);

  const setPiiSensitivity = useCallback(async (tier: PiiSensitivityTier) => {
    setSecurityNotice(null);
    if (!canEditSecurity) {
      setSecurityNotice("Only an Admin can apply sensitivity. Use Propose instead.");
      return;
    }
    if (tier === piiSensitivity) return;
    const ok = window.confirm(
      `Change detection sensitivity to “${tier}”?\n\n` +
      `This applies going forward only:\n` +
      `• New chat messages and new Knowledge uploads use the new tier\n` +
      `• Existing messages and documents are NOT re-scanned or rewritten\n` +
      `• Already-redacted text stays redacted (nothing can be restored)`,
    );
    if (!ok) return;

    const res = await fetch("/api/settings/security", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ piiSensitivity: tier, safeTerms }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: string };
      setSecurityNotice(err.error || "Could not update security policy.");
      return;
    }
    const data = await res.json() as {
      piiSensitivity?: PiiSensitivityTier;
      safeTerms?: SafeTerm[];
      pending?: null;
    };
    if (data.piiSensitivity) setPiiSensitivityState(data.piiSensitivity);
    try { localStorage.setItem(PII_SENSITIVITY_KEY, tier); } catch { /* quota */ }
    if (Array.isArray(data.safeTerms)) {
      const terms = omitRetiredDefaultSafeTerms(data.safeTerms);
      setSafeTerms(terms);
      persistSafeTerms(terms);
    }
    setSecurityPending(null);
    setSecurityNotice(
      `Sensitivity set to ${tier}. Applies to new chat and Knowledge only — history was not re-scanned.`,
    );
  }, [canEditSecurity, piiSensitivity, safeTerms]);

  const proposeSecurity = useCallback(async (tier: PiiSensitivityTier) => {
    setSecurityNotice(null);
    const res = await fetch("/api/settings/security", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ piiSensitivity: tier, note: `Proposed ${tier} from Settings` }),
    });
    if (!res.ok) {
      setSecurityNotice("Could not submit proposal.");
      return;
    }
    const data = await res.json() as {
      pending?: null | {
        piiSensitivity: PiiSensitivityTier;
        note: string | null;
        stricterThanActive: boolean;
      };
    };
    setSecurityPending(data.pending ?? null);
    setSecurityNotice(`Proposed ${tier}. An Admin must accept before it applies.`);
  }, []);

  const acceptPendingSecurity = useCallback(async () => {
    if (!securityPending) return;
    await setPiiSensitivity(securityPending.piiSensitivity);
  }, [securityPending, setPiiSensitivity]);

  const dismissPendingSecurity = useCallback(async () => {
    const res = await fetch("/api/settings/security", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clearPending: true }),
    });
    if (res.ok) {
      setSecurityPending(null);
      setSecurityNotice("Pending proposal dismissed.");
    }
  }, []);

  const addSafeTerm = useCallback((kind: SafeTermKind, value: string, label?: string) => {
    const check = validateSafeTerm(value, kind);
    if (!check.ok) return check;
    if (!canEditSecurity) return { ok: false as const, reason: "Only an Admin can edit safe terms." };
    setSafeTerms(prev => {
      const next = [...prev, { id: crypto.randomUUID(), kind, value: value.trim(), label }];
      persistSafeTerms(next);
      void fetch("/api/settings/security", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ piiSensitivity, safeTerms: next }),
      }).then(async (res) => {
        if (!res.ok) setSecurityNotice("Safe term saved locally; server sync failed.");
      });
      return next;
    });
    return { ok: true } as const;
  }, [canEditSecurity, piiSensitivity]);

  const removeSafeTerm = useCallback((termId: string) => {
    if (!canEditSecurity) return;
    setSafeTerms(prev => {
      const next = prev.filter(t => t.id !== termId);
      persistSafeTerms(next);
      void fetch("/api/settings/security", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ piiSensitivity, safeTerms: next }),
      });
      return next;
    });
  }, [canEditSecurity, piiSensitivity]);

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
    attachedFileNames = [],
    attachmentExtracts = [],
  }: DeliverPayload) => {
    const turn = turnCount + 1;
    setTurnCount(turn);
    stickToBottomRef.current = true;

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
    const attachedFiles = [...new Set([
      ...attachedFileNames,
      ...attachedDocumentNamesFromText(attachmentHistoryBlock),
      ...attachedDocumentNamesFromText(messageToSend),
    ])];

    const now = new Date().toISOString();
    setMessages(p => [
      ...p,
      {
        // Keep attachment text in message content so follow-up turns still see it
        // in working memory (UI shows filenames; extract stays hidden).
        id: userId, role: "user", content: messageToSend,
        createdAt: now,
        segments, scrubEvents: hadRedactions ? scrubEvents : undefined,
        images: imageDataUrls.length > 0 ? imageDataUrls : undefined,
        attachedFiles: attachedFiles.length > 0 ? attachedFiles : undefined,
      },
      { id: asstId, role: "assistant", content: "", createdAt: now },
    ]);
    const startedAt = Date.now();
    setStreamStartedAt(startedAt);
    setStreamingMessageId(asstId);
    setIsStreaming(true);

    try {
      // Persist the history-enriched text so reloads and later turns retain the file.
      await persistMessage(sessionIdRef.current!, "user", messageToSend);
    } catch (err) {
      console.error("[messages] user save failed:", err);
      setSessionSaveError("Message could not be saved. Check your connection and try again.");
      setMessages(p => p.filter(m => m.id !== userId && m.id !== asstId));
      setIsStreaming(false);
      setStreamingMessageId(null);
      setStreamStartedAt(null);
      composerRef.current?.setValue(raw);
      return;
    }

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const sendStart = Date.now();
    let ttftCaptured = false;
    let asstContent = "";

    // Pre-wake local Node or remote Lambda before the heavy chat request.
    warmChatConnection();
    await ensureClientAccessToken();

    try {
      const res = await fetch(apiUrl("/api/chat"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...apiAuthHeaders(),
        },
        credentials: usesRemoteApi() ? "omit" : "same-origin",
        body: JSON.stringify({
          // Plain user ask for this turn; attachment bodies load via IDs server-side.
          message:           baseText || "Please review the attached file(s).",
          mode,
          workspaceId:       activeWorkspaceId ?? "",
          images:            imageDataUrls,
          attachmentDocumentIds,
          attachmentExtracts,
          sessionId:         sessionIdRef.current ?? "local",
          sessionSummary:    sessionSummaryRef.current,
          facts:             extractedFactsRef.current,
          modelOverrides: postedModelOverrides,
          history: messages
            .filter(m => m.role !== "assistant" || m.content)
            .slice(summarizedCountRef.current)
            .slice(-40)
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
          priorTurnHadAttachments: (() => {
            const lastUser = [...messages].reverse().find(m => m.role === "user");
            return Boolean(
              lastUser?.attachedFiles?.length ||
              (lastUser && attachedDocumentNamesFromText(lastUser.content).length > 0),
            );
          })(),
        }),
        signal: ctrl.signal,
      });

      if (res.status === 503) {
        const body = await res.json() as {
          error: string;
          code?: string;
          settingsSection?: SettingsSection;
        };
        setMessages(p => p.map(m => m.id === asstId ? {
          ...m,
          error: body.code === "VENDOR_RISK_REQUIRED" ||
            body.code === "GROQ_NOT_CONFIGURED" ||
            body.code === "BEDROCK_NOT_CONFIGURED" ||
            body.code === "MODEL_PROVIDER_REQUIRED" ||
            body.code === "MODEL_NOT_ASSIGNED" ||
            body.code === "OLLAMA_EMBED_MODEL"
            ? body.error
            : body.code === "OLLAMA_MODEL_MISSING"
              ? body.error
              : `Setup needed: ${body.error}`,
          errorCode: body.code,
          errorSettingsSection: body.settingsSection ??
            (body.code === "VENDOR_RISK_REQUIRED" ||
              body.code === "GROQ_NOT_CONFIGURED" ||
              body.code === "BEDROCK_NOT_CONFIGURED" ||
              body.code === "MODEL_PROVIDER_REQUIRED"
              ? "providers"
              : body.code === "MODEL_NOT_ASSIGNED"
                ? "inference"
                : undefined),
        } : m));
        return;
      }
      if (res.status === 401) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(
          body.error === "Authentication required."
            ? "Chat is signed out of the API. Refresh the page and send again."
            : `Server error: 401${body.error ? ` (${body.error})` : ""}`,
        );
      }
      if (!res.ok || !res.body) throw new Error(`Server error: ${res.status}`);

      const reader  = res.body.getReader();
      streamReaderRef.current = reader;
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
              code?: string;
              settingsSection?: SettingsSection;
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
                provider: parsed.route!.provider,
                at:      new Date().toISOString(),
                workspaceId:
                  activeWorkspaceId
                  ?? viewWorkspaceIdRef.current
                  ?? undefined,
              };
              setRouteHistory(prev => {
                const next = [...prev, hit].slice(-500);
                persistRouteHistory(next);
                return next;
              });
            }
            if (parsed.usage) {
              const u = parsed.usage;
              const target = messagesRef.current.find(m => m.id === asstId);
              if (target?.routeInfo) {
                const baseline = savingsBaselineModelRef.current;
                const priced = calcTurnCost(
                  target.routeInfo.provider,
                  target.routeInfo.model,
                  u.promptTokens,
                  u.completionTokens,
                  baseline,
                );
                const costUsd = priced?.costUsd;
                const savedUsd = priced?.savedUsd;
                setRouteHistory(rh => {
                  const next = [...rh];
                  const idx = next.length - 1;
                  if (idx >= 0 && next[idx].model === target.routeInfo!.model) {
                    next[idx] = {
                      ...next[idx],
                      provider: target.routeInfo!.provider,
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
              setMessages(p => p.map(m => m.id === asstId ? {
                ...m,
                error: parsed.error,
                errorCode: parsed.code,
                errorSettingsSection: parsed.settingsSection ??
                  (parsed.code === "VENDOR_RISK_REQUIRED" ? "providers" : undefined),
              } : m));
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
            error: msg.includes("Failed to fetch")
              ? chatUnreachableMessage(runtimeStatus?.edition === "local" ? "local" : "cloud")
              : msg,
            ...(msg.includes("Failed to fetch")
              ? { errorCode: "MODEL_PROVIDER_REQUIRED" as const, errorSettingsSection: "providers" as const }
              : {}),
          }
          : m,
      ));
    } finally {
      setIsStreaming(false);
      setStreamingMessageId(null);
      setStreamStartedAt(null);
      abortRef.current = null;
      streamReaderRef.current = null;
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
    turnCount, mode, workspaceName, activeWorkspace, activeWorkspaceId,
    postedModelOverrides, messages, lastRouteInfo, piiSensitivity, runtimeStatus,
  ]);

  const handleSend = useCallback(async (textOverride?: string) => {
    const raw = (textOverride ?? composerRef.current?.getValue() ?? "").trim();
    if (!raw && attachments.length === 0) return;
    if (sendInFlightRef.current || isStreaming) return;
    if (sessionLoading || !sessionIdRef.current) {
      setSessionSaveError(previous => sessionLoading
        ? "Still loading your conversation — wait a moment and try again."
        : previous ?? "Your conversation could not be loaded. Refresh the page to reconnect.");
      return;
    }

    if (runtimeStatus && !runtimeStatus.chatReady) {
      const edition = runtimeStatus.edition === "local" ? "local" : "cloud";
      const now = new Date().toISOString();
      const userId = crypto.randomUUID();
      const asstId = crypto.randomUUID();
      const guide = noModelAssistantReply(edition);
      setSessionSaveError(null);
      composerRef.current?.clear?.();
      setMessages(p => [
        ...p,
        { id: userId, role: "user", content: raw, createdAt: now },
        { id: asstId, role: "assistant", content: guide, createdAt: now },
      ]);
      try {
        await persistMessage(sessionIdRef.current, "user", raw);
        await persistMessage(sessionIdRef.current, "assistant", guide);
      } catch {
        setSessionSaveError("Message could not be saved. Check your connection and try again.");
      }
      return;
    }
    setSessionSaveError(null);
    if (voiceState !== "idle") cancelVoice();

    const pendingAttachments = [...attachments];
    sendInFlightRef.current = true;
    setSendInFlight(true);

    try {
    // Await Knowledge ingest so scrubbed text is available for this chat turn.
    // Images also stay available for vision.
    let uploadedDocs: { id: string; name: string; content: string }[] = [];
    if (pendingAttachments.length > 0) {
      setKnowledgeIngestNote(
        pendingAttachments.length === 1
          ? `Adding ${pendingAttachments[0].name} to Knowledge…`
          : `Adding ${pendingAttachments.length} files to Knowledge…`,
      );
      uploadedDocs = await ingestChatAttachmentsRef.current(pendingAttachments);
      if (uploadedDocs.length === 0) {
        setKnowledgeIngestNote(
          "Could not add the file to Knowledge. Stay on this page, check sign-in, and try Send again.",
        );
        return;
      }
    }
    const attachmentDocumentIds = uploadedDocs.map(d => d.id);
    const attachedFileNames = uploadedDocs.map(d => d.name);
    const attachmentExtracts = uploadedDocs.map(d => ({
      id: d.id,
      name: d.name,
      content: d.content.slice(0, MAX_ATTACHMENT_PROMPT_CHARS),
    }));
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
        attachedFileNames,
        attachmentExtracts,
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
      attachedFileNames,
      attachmentExtracts,
    });
    } finally {
      sendInFlightRef.current = false;
      setSendInFlight(false);
    }
  }, [
    attachments, isStreaming, sessionLoading, voiceState, cancelVoice,
    piiSensitivity, safeTerms, deliverMessage, runtimeStatus,
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
    void streamReaderRef.current?.cancel().catch(() => {});
    streamReaderRef.current = null;
    for (const timer of pollTimersRef.current.values()) clearTimeout(timer);
    pollTimersRef.current.clear();
    pollAttemptsRef.current.clear();
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
    const payload = await res.json().catch(() => null) as Workspace & { error?: string };
    if (!res.ok || !payload?.id) {
      setWorkspaceListError(payload?.error || "Could not create a workspace.");
      throw new Error(payload?.error || "Could not create a workspace.");
    }
    setWorkspaceListError(null);
    setWorkspaces(p => [...p, payload]);
    switchWorkspace(payload);
    return payload;
  }, [switchWorkspace]);

  const createNewWorkspace = useCallback(async () => {
    try {
      const agent = await createWorkspace({ name: "New workspace" });
      setViewWorkspaceId(agent.id);
      setExpandedWorkspaceId(agent.id);
      setActiveNav("workspace-settings");
    } catch {
      /* workspaceListError already set */
    }
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
      const res = await fetch(`/api/bookmarks?workspaceId=${agent.id}`);
      if (res.ok) {
        const data = await res.json() as { items?: unknown[] };
        bookmarks = data.items ?? [];
      }
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
    docsAbortRef.current?.abort();
    const ac = new AbortController();
    docsAbortRef.current = ac;
    setDocLoading(true);
    setDocError(null);
    try {
      await ensureClientAccessToken();
      const url = id ? `/api/documents?workspaceId=${id}` : "/api/documents";
      const res = await sessionApiFetch(url, { signal: ac.signal });
      if (res.ok) {
        setDocuments(await res.json() as DocRecord[]);
      } else {
        const body = await res.json().catch(() => null) as { error?: string } | null;
        setDocError(
          res.status === 401
            ? "Knowledge is signed out. Refresh the page, sign in, and open Knowledge again."
            : (body?.error ?? `Could not load documents (HTTP ${res.status}).`),
        );
        setDocuments([]);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      if (err instanceof Error && err.name === "AbortError") return;
      setDocError("Could not load documents — check your connection and try again.");
      setDocuments([]);
    } finally {
      if (docsAbortRef.current === ac) setDocLoading(false);
    }
  }, []);

  // Refetch documents when the viewed companion or Documents tab changes
  useEffect(() => {
    if (viewWorkspaceId && activeNav === "documents") fetchDocuments(viewWorkspaceId);
    return () => {
      docsAbortRef.current?.abort();
    };
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
    }
  }, [workspaces, activeNav, activeWorkspaceId, switchWorkspace]);

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
    }
  }, [
    analyticsView,
    router,
    workspaces,
    activeWorkspaceId,
    switchWorkspace,
  ]);

  /** Brand mark → product Home in the center pane (not Chat). */
  const goHome = useCallback(() => {
    setOpenWorkspacePickerId(null);
    lastWorkNavRef.current = "home";
    const id = viewWorkspaceId || activeWorkspaceId || workspaces[0]?.id;
    if (analyticsView) {
      try {
        sessionStorage.setItem(
          PENDING_WORK_NAV_KEY,
          JSON.stringify({ nav: "home", workspaceId: id ?? "" }),
        );
      } catch { /* private browsing */ }
      router.push("/");
      return;
    }
    setActiveNav("home");
  }, [analyticsView, router, viewWorkspaceId, activeWorkspaceId, workspaces]);

  // Restore Chat/Knowledge/Home/etc. after leaving an Insights dashboard.
  useEffect(() => {
    if (analyticsView) return;
    let pending: { nav?: string; workspaceId?: string } | null = null;
    try {
      const raw = sessionStorage.getItem(PENDING_WORK_NAV_KEY);
      if (!raw) return;
      sessionStorage.removeItem(PENDING_WORK_NAV_KEY);
      pending = JSON.parse(raw) as { nav?: string; workspaceId?: string };
    } catch {
      return;
    }
    if (!pending?.nav) return;
    const nav = pending.nav as NavId;
    if (nav === "security-dashboard") {
      router.push("/analytics/security");
      return;
    }
    if (nav === "home") {
      setActiveNav("home");
      lastWorkNavRef.current = "home";
      return;
    }
    if (workspaces.length === 0 || !pending.workspaceId) return;
    const agent = workspaces.find(w => w.id === pending!.workspaceId);
    if (!agent) return;
    setViewWorkspaceId(agent.id);
    setExpandedWorkspaceId(agent.id);
    setActiveNav(nav);
    lastWorkNavRef.current =
      nav === "settings" ? "thread" : nav;
    if (nav === "thread" && agent.id !== activeWorkspaceId) switchWorkspace(agent);
  }, [analyticsView, workspaces, activeWorkspaceId, switchWorkspace, router]);

  // Poll status only (?meta=1) so we never download chunks on a timer.
  const pollDocument = useCallback((id: string, ms = 3000) => {
    const existing = pollTimersRef.current.get(id);
    if (existing) clearTimeout(existing);
    const attempts = (pollAttemptsRef.current.get(id) ?? 0) + 1;
    if (attempts > 40) {
      pollAttemptsRef.current.delete(id);
      return;
    }
    pollAttemptsRef.current.set(id, attempts);
    const timer = setTimeout(async () => {
      pollTimersRef.current.delete(id);
      try {
        const res = await sessionApiFetch(`/api/documents/${id}?meta=1`);
        if (!res.ok) return;
        const updated = await res.json() as {
          status: DocRecord["status"];
          chunkCount: number;
          processingError?: string | null;
        };
        setDocuments(prev =>
          prev.map(d =>
            d.id === id
              ? { ...d, status: updated.status, chunkCount: updated.chunkCount, processingError: updated.processingError }
              : d,
          ),
        );
        setSelectedDoc(prev =>
          prev?.id === id
            ? { ...prev, status: updated.status, chunkCount: updated.chunkCount, processingError: updated.processingError }
            : prev,
        );
        if (updated.status === "processing") pollDocument(id, ms);
        else pollAttemptsRef.current.delete(id);
      } catch {
        // ignore — let the user refresh manually
      }
    }, ms);
    pollTimersRef.current.set(id, timer);
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
      const res = await sessionApiFetch("/api/documents", { method: "POST", body: fd });
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
        const msg = res.status === 401
          ? "Knowledge is signed out. Refresh the page, sign in, and upload again."
          : (body?.error ?? `Upload failed (HTTP ${res.status})`);
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
    const batch = files.slice(0, MAX_ATTACHMENTS_PER_TURN);
    const uploaded: { id: string; name: string; content: string }[] = [];
    let reused = 0;
    let created = 0;
    for (const file of batch) {
      const doc = await handleDocumentUpload(file, {
        workspaceId: activeWorkspaceId,
        quiet: true,
      });
      if (!doc) continue;
      if (doc.reused) reused++;
      else created++;
      uploaded.push({
        id: doc.id,
        name: doc.name,
        content: doc.content?.trim() ? doc.content : (doc.contentPreview ?? ""),
      });
    }
    if (uploaded.length > 0) {
      let note: string;
      if (created === 0 && reused > 0) {
        note = reused === 1
          ? "Already in Knowledge — using the existing copy for this chat."
          : `Already in Knowledge — using ${reused} existing files for this chat.`;
      } else if (reused === 0) {
        note = created === 1
          ? "Added to Knowledge — reviewing in this chat."
          : `Added ${created} files to Knowledge — reviewing in this chat.`;
      } else {
        note = `Knowledge updated (${created} new, ${reused} existing) — reviewing in this chat.`;
      }
      setKnowledgeIngestNote(note);
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
    const res = await sessionApiFetch(`/api/documents/${id}`);
    if (res.ok) setSelectedDoc(await res.json() as DocDetail);
  }, []);

  const deleteDocument = useCallback(async (id: string) => {
    await sessionApiFetch(`/api/documents/${id}`, { method: "DELETE" });
    setDocuments(prev => prev.filter(d => d.id !== id));
    if (selectedDoc?.id === id) setSelectedDoc(null);
  }, [selectedDoc]);

  const reprocessDocument = useCallback(async (id: string) => {
    setDocuments(prev => prev.map(d => d.id === id ? { ...d, status: "processing" } : d));
    if (selectedDoc?.id === id) {
      setSelectedDoc({ ...selectedDoc, status: "processing", processingError: null });
    }
    const res = await sessionApiFetch(`/api/documents/${id}/reprocess`, { method: "POST" });
    if (res.ok) pollDocument(id);
  }, [selectedDoc, pollDocument]);

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
    if (!msg || !activeWorkspaceId) return;
    const already = bookmarks.some(b => b.messageId === messageId);
    if (already) {
      setBookmarks(p => p.filter(b => b.messageId !== messageId));
      setMessages(p => p.map(m => m.id === messageId ? { ...m, bookmarked: false } : m));
      setUnseenBookmarkIds(prev => { const s = new Set(prev); s.delete(messageId); return s; });
      void fetch(`/api/bookmarks?workspaceId=${activeWorkspaceId}&messageId=${messageId}`, { method: "DELETE" });
    } else {
      const t = msg.content.trim();
      const preview = t.length > 200 ? t.slice(0, 200) + "…" : t;
      const entry: BookmarkEntry = {
        messageId,
        label:     msg.role === "assistant" ? workspaceName : "You",
        role:      msg.role,
        preview,
        heavy:     msg.content.includes("redacted]"),
        read:      false,
        createdAt: msg.createdAt ?? new Date().toISOString(),
        emojis:    extractEmojis(t),
      };
      setBookmarks(p => [...p, entry]);
      setMessages(p => p.map(m => m.id === messageId ? { ...m, bookmarked: true } : m));
      setUnseenBookmarkIds(prev =>
        activeNavRef.current === "bookmarks" ? prev : new Set([...prev, messageId]),
      );
      void fetch("/api/bookmarks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: activeWorkspaceId,
          messageId,
          label: entry.label,
          preview: entry.preview,
          role: entry.role,
          heavy: entry.heavy,
        }),
      });
    }
  }, [bookmarks, workspaceName, messages, activeWorkspaceId]);

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

    void fetch(`/api/bookmarks?workspaceId=${workspaceId}&messageId=${messageId}`, { method: "DELETE" });
  }, [activeWorkspaceId, viewWorkspaceId]);

  const dismissPiiRecord = useCallback((recordId: string) => {
    let category = "unknown";
    let workspaceId: string | undefined;
    let source: "investigate" | "knowledge_document" = "investigate";
    for (const entry of [...piiArchive, ...scrubLog]) {
      const rec = entry.redactions.find(r => r.id === recordId);
      if (rec) {
        category = rec.category;
        workspaceId = entry.workspaceId;
        source = entry.source === "document" ? "knowledge_document" : "investigate";
        break;
      }
    }
    setDismissedPiiIds(prev => {
      const next = new Set([...prev, recordId]);
      persistPiiDismissed(next);
      return next;
    });
    void postSecurityEvents({
      workspaceId,
      sensitivity: piiSensitivity,
      events: [{ category, source, outcome: "dismissed", count: 1 }],
    });
  }, [piiArchive, scrubLog, piiSensitivity]);

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

  // ── derived ──────────────────────────────────────────────────────────────────
  const totalRedactions = scrubLog.reduce((s, e) => s + e.events.reduce((ss, ev) => ss + ev.count, 0), 0);

  const knownWorkspaceIds = useMemo(
    () => new Set(workspaces.map(a => a.id)),
    [workspaces],
  );
  const rangedRouteHits = useMemo(
    () => taggedRouteHits(filterByRange(routeHistory, routeStatsRange), knownWorkspaceIds),
    [routeHistory, routeStatsRange, knownWorkspaceIds],
  );
  const filteredRouteHits = useMemo(
    () =>
      routeStatsWorkspaceId === "all"
        ? rangedRouteHits
        : rangedRouteHits.filter(h => h.workspaceId === routeStatsWorkspaceId),
    [rangedRouteHits, routeStatsWorkspaceId],
  );
  const tierUsageCounts = MODES.map(tier => ({
    tier,
    count: filteredRouteHits.filter(h => {
      const t = h.tier === "High" ? "Max" : h.tier === "Fast" ? "Light" : h.tier;
      return t === tier;
    }).length,
    modelId: displayModelForTier({
      tier,
      overrides: modeModelOverrides,
      cloudDefaultsWillRun,
      localFallbackModel,
      canRun: canRunAssignedModel,
    }),
  }));
  const totalRouteCalls = filteredRouteHits.length;

  const complexityTiersBind: ComplexityTiersBind = {
    deployment: runtimeStatus?.deployment,
    modelSelectionMode,
    onModelSelectionModeChange: setModelSelectionMode,
    modeModelOverrides,
    onAssignTier: assignTierModel,
    fixedModelId,
    onFixedModelIdChange: setFixedModelId,
    lastRoute: lastRouteInfo,
    chatCatalogModels,
    labelFor,
    providerFor,
    displayModelFor: displayModelIdForTier,
    tierStatus: tierModelStatus,
    usageCount: (tier) => tierUsageCounts.find(t => t.tier === tier)?.count ?? 0,
    changedTiers,
    cloudDefaultsWillRun,
    groqCatalogReady,
    ollamaCatalogReady,
    bedrockCatalogReady,
    localFallbackModel,
    onNeedCatalog: () => { void ensureLoaded(); },
  };

  const localSavingsStats = useMemo(() => {
    let totalCost = 0;
    let totalSaved = 0;
    let pricedCount = 0;
    const byModel: Record<string, { count: number; cost: number }> = {};
    for (const hit of filteredRouteHits) {
      const priced = turnCostForHit(hit, savingsBaselineModel);
      if (!priced) continue;
      pricedCount += 1;
      totalCost += priced.costUsd;
      totalSaved += priced.savedUsd;
      if (!byModel[hit.model]) byModel[hit.model] = { count: 0, cost: 0 };
      byModel[hit.model].count += 1;
      byModel[hit.model].cost += priced.costUsd;
    }
    const modelRows = Object.entries(byModel)
      .map(([modelId, v]) => ({ modelId, ...v }))
      .sort((a, b) => b.cost - a.cost);
    return {
      totalCost,
      totalSaved,
      modelRows,
      responseCount: filteredRouteHits.length,
      pricedCount,
    };
  }, [filteredRouteHits, savingsBaselineModel]);

  // Prefer durable server inference events (same as full Cost view); fall back to this browser.
  const savingsStats = useMemo(() => {
    const serverCount = serverCost
      ? serverCost.kpis.pricedRequests + serverCost.kpis.unpricedRequests
      : 0;
    if (serverCost && serverCount > 0) {
      return {
        totalCost: serverCost.kpis.estimatedCostUsd,
        totalSaved: serverCost.kpis.routingSavingsUsd,
        modelRows: serverCost.byModel.map(m => ({
          modelId: m.model,
          count: 0,
          cost: m.costUsd,
        })),
        responseCount: serverCount,
        pricedCount: serverCost.kpis.pricedRequests,
        source: "server" as const,
      };
    }
    return { ...localSavingsStats, source: "local" as const };
  }, [serverCost, localSavingsStats]);

  // Hydrate Insights → Cost from /api/analytics/cost whenever filters change.
  useEffect(() => {
    if (insightsTab !== "savings") return;
    let cancelled = false;
    let first = true;
    const load = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      if (first) setServerCostLoading(true);
      fetchAnalyticsJson<InsightsCostPayload>("cost", {
        range: statsRangeToAnalytics(routeStatsRange),
        workspaceId: routeStatsWorkspaceId,
      })
        .then(data => {
          if (!cancelled) setServerCost(data);
        })
        .catch(() => {
          if (!cancelled) setServerCost(null);
        })
        .finally(() => {
          if (!cancelled) {
            setServerCostLoading(false);
            first = false;
          }
        });
    };
    load();
    const id = window.setInterval(load, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [insightsTab, routeStatsRange, routeStatsWorkspaceId]);

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
  const recentPiiItems = useMemo(() =>
    [...activePiiItems]
      .sort((a, b) => new Date(b.entry.at).getTime() - new Date(a.entry.at).getTime())
      .slice(0, 3),
  [activePiiItems]);

  // ── intelligence panel ───────────────────────────────────────────────────────
  const IntelligencePanel = (
    <div className="flex flex-col h-full gap-0">
      <Tabs
        value={insightsTab}
        onValueChange={v => {
          if (v === "security" || v === "context" || v === "savings") setInsightsTab(v);
        }}
        className="flex flex-1 min-h-0 flex-col gap-0"
      >
        {/* Header + section tabs — tabs are the primary chrome; drag to reorder */}
        <div className="shrink-0 pb-3 mb-3 border-b border-border">
          <div className="flex items-start gap-3 mb-3.5">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl
                            bg-[var(--primary-soft)] border border-[var(--primary-border)]
                            shadow-[var(--shadow-sm)]">
              <Sparkles className="size-5 text-[var(--primary-soft-foreground)]" aria-hidden />
            </div>
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="text-section leading-none">Insights</p>
              <p className="text-meta mt-2 leading-[var(--leading-body)] max-w-[36ch]">
                Models, cost, and detected sensitive-data risk for this account. Drag tabs or section headers to reorder.
              </p>
            </div>
          </div>

          <InsightsTabsList
            order={insightsTabOrder}
            onReorder={setInsightsTabOrder}
            securityBadge={totalRedactions}
          />
        </div>

        {/* Tab body — each tab is a VS Code–style collapsible/resizable stack */}
        <div className="flex-1 min-h-0 flex flex-col">
          <TabsContent value="context" className="mt-0 flex-1 min-h-0 data-[state=inactive]:hidden flex flex-col">
            <IntelPanelStack
              storageKey="sm_intel_panels_usage_v6"
              defaultOrder={["model", "last-response"]}
              panels={[
                {
                  id: "model",
                  label: "Models",
                  defaultOpen: true,
                  defaultHeight: INTEL_HEIGHT.routing,
                  children: (
                    <>
                      <ComplexityTiersEditor
                        variant="rail"
                        {...complexityTiersBind}
                        onOpenSettings={() => openSettings("inference")}
                        beforeList={(
                          <div className="mb-2 space-y-1.5">
                            <div className="flex items-center gap-1.5">
                              <div className="min-w-0 flex-1">
                                <WorkspaceStatsFilter
                                  workspaces={workspaces}
                                  value={routeStatsWorkspaceId}
                                  onChange={setRouteStatsWorkspaceId}
                                />
                              </div>
                            </div>
                            <StatsRangePicker value={routeStatsRange} onChange={setRouteStatsRange} />
                            <p className="text-[0.62rem] text-foreground/30 px-0.5">
                              {totalRouteCalls === 0
                                ? routeStatsWorkspaceId === "all"
                                  ? "No AI responses yet for this range."
                                  : "No responses for this workspace in this range."
                                : `${totalRouteCalls} response${totalRouteCalls !== 1 ? "s" : ""} routed`}
                            </p>
                          </div>
                        )}
                      />
                      <Link
                        href="/analytics/usage"
                        className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary py-2.5 text-[0.72rem] font-semibold text-primary-foreground hover:bg-[var(--primary-hover)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <BarChart2 className="size-3.5 shrink-0" aria-hidden />
                        Open full usage view
                        <ChevronRight className="size-3.5 shrink-0 opacity-80" aria-hidden />
                      </Link>
                    </>
                  ),
                },
                {
                  id: "last-response",
                  label: "Last response",
                  visible: Boolean(lastRouteInfo),
                  defaultHeight: INTEL_HEIGHT.snug,
                  children: lastRouteInfo ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <ProviderBadge
                          provider={lastRouteInfo.provider}
                          className="text-[0.6rem] font-mono"
                        />
                        <code className="text-[0.65rem] font-mono text-foreground/50">{labelFor(lastRouteInfo.model)}</code>
                        {lastRouteInfo.wasAutoRouted && (
                          <span className="text-[0.55rem] text-indigo-400/50 font-mono uppercase tracking-wide">auto</span>
                        )}
                      </div>
                      {lastRouteInfo.latencyMs !== undefined && (
                        <p className="text-[0.65rem] text-foreground/30 tabular-nums">
                          TTFT:{" "}
                          <span className="text-foreground/50 font-mono">
                            {lastRouteInfo.latencyMs < 1000
                              ? `${lastRouteInfo.latencyMs}ms`
                              : `${(lastRouteInfo.latencyMs / 1000).toFixed(1)}s`}
                          </span>
                        </p>
                      )}
                    </div>
                  ) : null,
                },
              ]}
            />
          </TabsContent>

          <TabsContent value="security" className="mt-0 flex-1 min-h-0 data-[state=inactive]:hidden flex flex-col">
            <IntelPanelStack
              storageKey="sm_intel_panels_security_v2"
              panels={[
                {
                  id: "pii-detected",
                  label: "Detections",
                  defaultHeight: INTEL_HEIGHT.paired,
                  children: (
                    <>
                      <StatsRangePicker value={piiStatsRange} onChange={setPiiStatsRange} />
                      <div className="mt-3 flex items-baseline gap-2">
                        <span className="text-3xl font-bold tabular-nums text-foreground/90">{totalPiiFiltered}</span>
                        <span className="text-xs text-foreground/40">
                          detection{totalPiiFiltered !== 1 ? "s" : ""} recorded
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
                          <p className="text-[0.58rem] uppercase tracking-wider text-foreground/30 font-semibold">
                            Recent
                          </p>
                          <ul className="space-y-1">
                            {recentPiiItems.map(({ entry, rec }) => {
                              const ag = workspaceDisplay(workspaces, entry.workspaceId);
                              return (
                                <li key={rec.id}>
                                  <Link
                                    href={`/analytics/security#pii-record-${rec.id}`}
                                    className="w-full text-left rounded-lg border border-border bg-elevated px-2.5 py-2 hover:bg-muted hover:border-indigo-500/25 transition-colors cursor-pointer group block"
                                  >
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="text-[0.62rem] font-medium text-red-300/80 truncate">
                                        {categoryLabel(rec.category)}
                                      </span>
                                      <span className="text-[0.58rem] text-foreground/25 tabular-nums shrink-0">
                                        {formatDateDivider(entry.at) === "Today"
                                          ? formatMsgTime(entry.at)
                                          : formatDateDivider(entry.at)}
                                      </span>
                                    </div>
                                    <p className="text-[0.6rem] text-foreground/35 font-mono truncate mt-0.5 group-hover:text-foreground/50">
                                      {rec.context}
                                    </p>
                                    <p className="text-[0.55rem] text-foreground/25 mt-0.5 truncate">
                                      {ag.emoji && <span aria-hidden>{ag.emoji} </span>}
                                      {ag.name}
                                      <span className="text-indigo-300/50 group-hover:text-indigo-300/80">
                                        {" · "}Open in Security
                                      </span>
                                    </p>
                                  </Link>
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
                      <Link
                        href="/analytics/security"
                        className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary py-2.5 text-[0.72rem] font-semibold text-primary-foreground hover:bg-[var(--primary-hover)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Shield className="size-3.5 shrink-0" aria-hidden />
                        Open full security view
                        <ChevronRight className="size-3.5 shrink-0 opacity-80" aria-hidden />
                      </Link>
                      <p className="mt-1.5 text-center text-[0.55rem] text-foreground/30 leading-relaxed">
                        Policy, detection log, and charts as separate tabs. Same page as Settings → Insights → Security.
                      </p>
                    </>
                  ),
                },
                {
                  id: "pii-protection",
                  label: "Detection policy",
                  defaultHeight: INTEL_HEIGHT.normal,
                  children: (
                    <>
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span className="text-[0.62rem] text-foreground/40">Sensitivity</span>
                        <span className="rounded-md bg-indigo-500/15 border border-indigo-400/25 px-2 py-0.5 text-[0.65rem] font-semibold capitalize text-indigo-200/90">
                          {piiSensitivity}
                        </span>
                      </div>
                      <p className="text-[0.58rem] text-foreground/32 mb-2.5 leading-relaxed">
                        Scanned in your browser before send. Detected values are replaced — the scan can miss some.
                      </p>
                      <p className="text-[0.58rem] uppercase tracking-wider text-foreground/30 font-semibold mb-1.5">
                        Detecting ({activePiiCategories.length})
                      </p>
                      <ul className="space-y-1 mb-2.5">
                        {activePiiCategories.map(label => {
                          const CatIcon = PII_SCAN_ICONS[label] ?? Shield;
                          return (
                            <li key={label} className="flex items-center gap-2 text-[0.65rem] text-foreground/55">
                              <CatIcon className="size-3 shrink-0 text-foreground/35" aria-hidden />
                              <span className="truncate">{label}</span>
                            </li>
                          );
                        })}
                      </ul>
                      {inactivePiiCategories.length > 0 && (
                        <p className="text-[0.58rem] text-foreground/28 mb-2.5 leading-relaxed">
                          Off at this tier:{" "}
                          <span className="text-foreground/35">
                            {inactivePiiCategories.join(", ")}
                          </span>
                          . That is not the Safe terms list — exemptions can still skip a value
                          while its category stays on.
                        </p>
                      )}
                      <div className="rounded-lg bg-foreground/[0.04] border border-foreground/8 px-2.5 py-2 mb-2 space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[0.62rem] text-foreground/40">Safe terms</span>
                          <span className="text-[0.65rem] font-medium tabular-nums text-foreground/65">
                            {safeTerms.length} exemption{safeTerms.length !== 1 ? "s" : ""}
                          </span>
                        </div>
                        <p className="text-[0.55rem] text-foreground/32 leading-relaxed">
                          Documentation mail is exempt:{" "}
                          {safeTerms
                            .filter(t => t.kind === "domain" && isShippedDefaultSafeTerm(t))
                            .map(t => t.value)
                            .join(", ") || "none"}
                          . Not real people — listed in Settings → Workspace.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => openSettings("workspace")}
                        className="w-full py-1.5 text-center text-[0.62rem] text-foreground/40 hover:text-foreground/70 transition-colors cursor-pointer"
                      >
                        Adjust sensitivity & safe terms
                      </button>
                      <Link
                        href="/analytics/security"
                        className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary py-2.5 text-[0.72rem] font-semibold text-primary-foreground hover:bg-[var(--primary-hover)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Shield className="size-3.5 shrink-0" aria-hidden />
                        Open full security view
                        <ChevronRight className="size-3.5 shrink-0 opacity-80" aria-hidden />
                      </Link>
                    </>
                  ),
                },
              ]}
            />
          </TabsContent>

          {/* ── Savings tab ─────────────────────────────────────────────────── */}
          <TabsContent value="savings" className="mt-0 flex-1 min-h-0 data-[state=inactive]:hidden flex flex-col">
            <IntelPanelStack
              storageKey="sm_intel_panels_cost_v3"
              panels={[
                {
                  id: "session-cost",
                  label: "Estimated total cost",
                  defaultHeight: INTEL_HEIGHT.costTotal,
                  children: (
                    <>
                      <WorkspaceStatsFilter
                        workspaces={workspaces}
                        value={routeStatsWorkspaceId}
                        onChange={setRouteStatsWorkspaceId}
                      />
                      <StatsRangePicker value={routeStatsRange} onChange={setRouteStatsRange} />
                      {serverCostLoading && savingsStats.responseCount === 0 ? (
                        <p className="text-[0.65rem] text-[var(--text-secondary)] mt-2 py-4 text-center">
                          Loading cost estimates…
                        </p>
                      ) : savingsStats.responseCount === 0 ? (
                        <div className="mt-2 py-3 space-y-2 text-center">
                          <p className="text-[0.65rem] text-[var(--text-secondary)] leading-relaxed">
                            {routeStatsWorkspaceId !== "all" && rangedRouteHits.length > 0
                              ? "No routed responses for this workspace in the selected range."
                              : "No routed responses in this range — send a chat message to start tracking."}
                          </p>
                          {routeStatsWorkspaceId !== "all" && rangedRouteHits.length > 0 && (
                            <button
                              type="button"
                              onClick={() => setRouteStatsWorkspaceId("all")}
                              className="text-[0.65rem] font-medium text-[var(--primary)] hover:underline cursor-pointer"
                            >
                              Show all workspaces ({rangedRouteHits.length})
                            </button>
                          )}
                          {routeStatsRange !== "all" && (
                            <button
                              type="button"
                              onClick={() => setRouteStatsRange("all")}
                              className="block mx-auto text-[0.65rem] font-medium text-[var(--primary)] hover:underline cursor-pointer"
                            >
                              Try All time
                            </button>
                          )}
                          <p className="text-[0.58rem] text-[var(--text-muted)] leading-relaxed px-1">
                            Combines Groq, Bedrock, and Ollama list-rate estimates from recorded usage.
                          </p>
                        </div>
                      ) : (
                        <>
                          <div className="mt-3 flex items-baseline justify-between gap-2">
                            <span className="text-xs text-[var(--text-secondary)]">Estimated total</span>
                            <span className="text-2xl font-bold font-mono tabular-nums text-foreground">
                              {fmtUsd(savingsStats.totalCost)}
                            </span>
                          </div>
                          <p className="text-[0.58rem] text-[var(--text-muted)] mt-1 tabular-nums leading-relaxed">
                            {savingsStats.responseCount} response{savingsStats.responseCount !== 1 ? "s" : ""}
                            {savingsStats.pricedCount < savingsStats.responseCount
                              ? ` · ${savingsStats.pricedCount} priced`
                              : ""}
                            {savingsStats.source === "server"
                              ? " · account · Groq / Bedrock / Ollama list-rate estimate"
                              : " · this browser · Groq / Bedrock / Ollama list-rate estimate"}
                          </p>
                        </>
                      )}
                      <Link
                        href="/analytics/cost"
                        className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary py-2.5 text-[0.72rem] font-semibold text-primary-foreground hover:bg-[var(--primary-hover)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <BarChart2 className="size-3.5 shrink-0" aria-hidden />
                        Open full cost view
                        <ChevronRight className="size-3.5 shrink-0 opacity-80" aria-hidden />
                      </Link>
                    </>
                  ),
                },
                {
                  id: "by-model",
                  label: "By model",
                  visible: savingsStats.responseCount > 0,
                  defaultHeight: INTEL_HEIGHT.tall,
                  children: (
                    <>
                      <p className="text-[0.58rem] text-foreground/32 mb-2 leading-relaxed">
                        Estimated list-rate spend per model (not an invoice). Unknown rates are omitted.
                      </p>
                      <div className="space-y-1">
                        {savingsStats.modelRows.map(({ modelId, count, cost }) => (
                          <div
                            key={modelId}
                            className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 bg-foreground/[0.04]"
                          >
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-foreground/70 truncate">{labelFor(modelId)}</p>
                              <p className="text-[0.6rem] text-foreground/30 tabular-nums">
                                {count > 0
                                  ? `${count} call${count !== 1 ? "s" : ""} · ${fmtUsd(cost / count)} avg`
                                  : "list-rate estimate"}
                              </p>
                            </div>
                            <span className="text-xs font-mono font-semibold tabular-nums text-foreground/55 shrink-0">
                              {fmtUsd(cost)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </>
                  ),
                },
                {
                  id: "compare-vs",
                  label: "Compare vs",
                  visible: savingsStats.responseCount > 0,
                  defaultHeight: INTEL_HEIGHT.snug,
                  children: (
                    <>
                      <p className="text-[0.58rem] text-foreground/32 mb-2 leading-relaxed">
                        Pick a baseline model — savings show what you avoided by not using it for every response.
                      </p>
                      <SavingsBaselinePicker
                        value={savingsBaselineModel}
                        onChange={setSavingsBaseline}
                        models={chatCatalogModels}
                      />
                      <div className="flex items-baseline justify-between gap-2 mt-1">
                        <span className="text-xs text-foreground/45">
                          Saved vs {labelFor(savingsBaselineModel)}
                        </span>
                        <span className={cn(
                          "text-lg font-bold font-mono tabular-nums",
                          savingsStats.totalSaved > 0 ? "text-emerald-400/90" : "text-foreground/35",
                        )}>
                          {fmtUsd(savingsStats.totalSaved)}
                        </span>
                      </div>
                    </>
                  ),
                },
              ]}
            />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );

  // ── render ───────────────────────────────────────────────────────────────────

  // Analytics dashboards render in the center pane; the Settings sheet stays
  // closed unless the user explicitly opens Settings.
  const onAnalytics = Boolean(analyticsView);
  const settingsVisible =
    activeNav === "settings"
    || settingsAnimatingOut
    || (onAnalytics && !settingsMenuCollapsed);
  const settingsExpanded =
    (activeNav === "settings" || onAnalytics)
    && !settingsAnimatingOut
    && !settingsMenuCollapsed;
  const settingsNavExpanded = settingsExpanded && !settingsEntering;

  const settingsContentShown =
    activeNav === "settings" && !settingsAnimatingOut && !settingsEntering && !onAnalytics;
  /** Settings / admin Insights own the header — not the workspace Chat breadcrumb. */
  const settingsHeaderShown =
    (settingsContentShown || onAnalytics) && !settingsAnimatingOut && !settingsEntering;
  const workContentShown = onAnalytics || !settingsVisible || settingsAnimatingOut;
  const workNav: NavId = activeNav === "settings" ? lastWorkNavRef.current : activeNav;
  const headerWorkNav: NavId = workNav;

  const analyticsTabLabel =
    analyticsView === "usage" ? "Usage"
      : analyticsView === "cost" ? "Cost"
        : analyticsView === "security" ? "Security"
          : null;

  return (
    <div className="flex h-dvh overflow-hidden bg-background">

      <VoiceSttSetupDialog
        open={voiceSetupOpen}
        onClose={() => setVoiceSetupOpen(false)}
        onSaved={async () => {
          const next = await refreshRuntimeStatus();
          setVoiceSetupOpen(false);
          if (next?.capabilities.voiceStt?.ready) {
            await startVoice();
          }
        }}
      />

      {deleteConfirmWorkspace && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-overlay backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-popover border border-foreground/10 p-6 shadow-2xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-red-500/15 border border-red-500/25">
                <Trash2 className="size-5 text-red-400" aria-hidden />
              </div>
              <div>
                <h2 className="text-section">Remove {deleteConfirmWorkspace.name}?</h2>
                <p className="text-ui text-[var(--text-muted)] mt-1.5 leading-[var(--leading-body)]">
                  All contents for this workspace will be permanently deleted — investigations, memory, knowledge, and saved conclusions.
                </p>
              </div>
            </div>
            <label className="flex items-start gap-2.5 rounded-xl border border-foreground/8 bg-foreground/[0.03] px-3 py-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={deleteWithBackup}
                onChange={e => setDeleteWithBackup(e.target.checked)}
                className="mt-0.5 accent-indigo-500"
              />
              <span className="text-xs text-foreground/50 leading-relaxed">
                Download a backup file first (profile + saved conclusions). Investigation history in the database is not included in this export yet.
              </span>
            </label>
            <div className="flex gap-2 justify-end pt-1">
              <Button
                type="button"
                variant="ghost"
                className="text-foreground/50"
                disabled={deleteBusy}
                onClick={() => setDeleteConfirmWorkspace(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                className="bg-red-600 hover:bg-red-500 text-foreground"
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
          className="fixed inset-0 z-[100] flex items-center justify-center bg-overlay backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="presend-title"
        >
          <div className="w-full max-w-lg rounded-2xl bg-popover border border-foreground/10 p-6 shadow-2xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 border border-amber-500/25">
                <ShieldAlert className="size-5 text-amber-400" aria-hidden />
              </div>
              <div className="min-w-0">
                <h2 id="presend-title" className="text-section">
                  Review before sending
                </h2>
                <p className="text-sm text-foreground/45 mt-1.5 leading-relaxed">
                  These values were detected and will be replaced before your message leaves this
                  device. Detection is best-effort — review the result. The original text stays in the composer.
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

            <div className="rounded-xl border border-foreground/8 bg-foreground/[0.03] px-3 py-2.5 max-h-48 overflow-y-auto">
              <p className="text-[0.58rem] uppercase tracking-wider text-foreground/30 mb-1.5">
                What will be sent
              </p>
              <p className="text-xs text-foreground/65 font-mono leading-relaxed whitespace-pre-wrap break-words">
                {pendingSend.sanitized}
              </p>
            </div>

            {pendingSend.safeTermMatches.length > 0 && (
              <p className="text-[0.65rem] text-foreground/35 leading-relaxed">
                {pendingSend.safeTermMatches.reduce((n, m) => n + m.count, 0)} further match
                {pendingSend.safeTermMatches.reduce((n, m) => n + m.count, 0) === 1 ? " was" : "es were"}
                {" "}left in place by your safe terms.
              </p>
            )}

            <div className="flex gap-2 justify-end pt-1">
              <Button
                type="button"
                variant="ghost"
                className="text-foreground/50"
                onClick={cancelPendingSend}
              >
                Cancel and edit
              </Button>
              <Button
                type="button"
                autoFocus
                className="bg-indigo-600 hover:bg-indigo-500 text-foreground"
                onClick={() => void confirmPendingSend()}
              >
                Send redacted
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Left sidebar ─────────────────────────────────────────────────── */}
      <aside
        className="hidden md:flex shrink-0 flex-col border-r border-foreground/6 bg-sidebar relative"
        style={{ width: leftSidebar.width }}
      >
        <SidebarResizeHandle
          edge="right"
          label="Resize workspaces sidebar"
          active={leftSidebar.dragging}
          onPointerDown={e => leftSidebar.startResize("right", e)}
        />

        {/* Brand header — home → Chat for the current workspace */}
        <div className="px-4 pt-5 pb-4 border-b border-foreground/[0.07] shrink-0">
          <button
            type="button"
            onClick={goHome}
            aria-label="Go to Home"
            title="Go to Home"
            className="flex w-full items-center gap-3 rounded-xl text-left cursor-pointer
                       transition-colors hover:bg-foreground/[0.04]
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ProductMark
              size={40}
              className="size-10 shrink-0 shadow-[0_4px_20px_rgba(99,102,241,0.45)]"
            />
            <div className="min-w-0">
              <p className="text-[length:var(--font-size-body)] font-semibold text-foreground leading-none tracking-[var(--tracking-ui)]">SecureMind</p>
              <p className="text-meta mt-1 text-[var(--primary-soft-foreground)]">{PRODUCT_CHROME_TAGLINE}</p>
            </div>
          </button>
        </div>

        {/* Workspaces (top). Settings opens as an elevated sheet above the bottom toggle. */}
        <div className="flex flex-col flex-1 min-h-0 relative">
          <div
            className={cn(
              "flex flex-col gap-1 px-2.5 py-3 overflow-y-auto flex-1 min-h-0 transition-[filter,opacity] duration-200",
              settingsNavExpanded && "opacity-45",
            )}
          >
          <div className="flex items-center justify-between px-1.5 mb-2">
            <p className="text-[0.58rem] uppercase tracking-[0.28em] text-foreground/35 font-semibold">Workspaces</p>
            <button
              onClick={() => { void createNewWorkspace(); }}
              className="flex size-6 items-center justify-center rounded-lg text-foreground/35 hover:text-foreground/70 hover:bg-foreground/6 transition-colors cursor-pointer"
              title="New workspace"
            >
              <span className="text-base leading-none">+</span>
            </button>
          </div>
          {workspaceListError && (
            <p role="alert" className="px-1.5 mb-2 text-meta text-red-300/90">{workspaceListError}</p>
          )}
          {workspacesReady && workspaces.length === 0 && !workspaceListError && (
            <p className="px-1.5 mb-2 text-meta">
              Your first workspace, Mindy Locke, appears here after the list loads. Use + if you need another.
            </p>
          )}

          {(() => {
            const reorderingWorkspaces = dragWorkspaceId != null;
            const updateWsDrop = (next: number | null) => {
              workspaceDropIndexRef.current = next;
              setWorkspaceDropIndex(prev => (prev === next ? prev : next));
            };
            const commitWsDrop = (e: DragEvent) => {
              e.preventDefault();
              const source =
                dragWorkspaceId
                ?? e.dataTransfer.getData("text/plain");
              const at = workspaceDropIndexRef.current;
              setDragWorkspaceId(null);
              updateWsDrop(null);
              if (!source || at == null) return;
              suppressWorkspaceClick.current = true;
              setWorkspaceListOrder(reorderIds(workspaceListOrder, source, at));
            };

            return (
              <>
                {orderedWorkspaces.map((agent, index) => {
                  const isViewing = agent.id === viewWorkspaceId;
                  const isExpanded = expandedWorkspaceId === agent.id;
                  const dragging = dragWorkspaceId === agent.id;
                  const showLineBefore = reorderingWorkspaces && workspaceDropIndex === index;

                  return (
                    <div key={agent.id} className="contents">
                      <div
                        className={cn(
                          "relative shrink-0 transition-[height] duration-100",
                          reorderingWorkspaces ? "h-3" : "h-0",
                        )}
                        onDragOver={e => {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                          updateWsDrop(index);
                        }}
                        onDrop={commitWsDrop}
                      >
                        {showLineBefore && (
                          <div
                            role="presentation"
                            className="pointer-events-none absolute inset-x-1 top-1/2 z-30 flex -translate-y-1/2 items-center gap-1.5"
                          >
                            <span className="size-2 shrink-0 rounded-full bg-indigo-400 shadow-[0_0_10px_rgba(129,140,248,0.95)]" />
                            <span className="h-[3px] flex-1 rounded-full bg-indigo-400 shadow-[0_0_12px_rgba(129,140,248,0.85)]" />
                            <span className="size-2 shrink-0 rounded-full bg-indigo-400 shadow-[0_0_10px_rgba(129,140,248,0.95)]" />
                          </div>
                        )}
                      </div>

                      <div
                        className={cn("rounded-xl", dragging && "opacity-40")}
                        onDragOver={e => {
                          const el =
                            workspaceRowRefs.current[agent.id]
                            ?? (e.currentTarget as HTMLElement);
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                          const rect = el.getBoundingClientRect();
                          const ratio = rect.height > 0 ? (e.clientY - rect.top) / rect.height : 1;
                          updateWsDrop(ratio < 0.35 ? index : index + 1);
                        }}
                        onDrop={commitWsDrop}
                      >
                        {/* Workspace row — drag name row to reorder; avatar → settings */}
                        <div
                          ref={el => {
                            workspaceRowRefs.current[agent.id] = el;
                          }}
                          className={cn(
                            "group/ws flex w-full items-center gap-2 px-1.5 py-1.5 rounded-xl transition-colors",
                            isViewing ? "bg-foreground/[0.07]" : "hover:bg-foreground/[0.04]",
                          )}
                        >
                          <button
                            type="button"
                            onClick={e => {
                              e.stopPropagation();
                              goToWorkspaceNav("workspace-settings", agent);
                            }}
                            className="workspace-avatar flex size-9 shrink-0 items-center justify-center rounded-xl text-base transition-all hover:ring-2 hover:ring-foreground/20 hover:scale-[1.06] active:scale-100 cursor-pointer"
                            style={{ "--ws-accent": agent.color } as CSSProperties}
                            title={`Workspace settings · ${agent.name}`}
                          >
                            {agent.emoji}
                          </button>

                          <button
                            type="button"
                            draggable
                            title="Drag to reorder · click to expand"
                            onDragStart={e => {
                              setDragWorkspaceId(agent.id);
                              updateWsDrop(null);
                              e.dataTransfer.effectAllowed = "move";
                              e.dataTransfer.setData("text/plain", agent.id);
                            }}
                            onDragEnd={() => {
                              if (dragWorkspaceId) suppressWorkspaceClick.current = true;
                              setDragWorkspaceId(null);
                              updateWsDrop(null);
                            }}
                            onClick={() => {
                              if (suppressWorkspaceClick.current) {
                                suppressWorkspaceClick.current = false;
                                return;
                              }
                              handleWorkspaceClick(agent);
                            }}
                            className="flex flex-1 min-w-0 items-center gap-1.5 rounded-lg px-1 py-1.5 text-left cursor-grab active:cursor-grabbing"
                          >
                    <p className={cn(
                      "flex-1 min-w-0 text-[length:var(--font-size-ui)] truncate leading-[var(--leading-ui)]",
                      isViewing
                        ? "font-medium text-foreground"
                        : "font-normal text-[var(--text-secondary)]",
                    )}>{agent.name}</p>
                            <GripVertical
                              aria-hidden
                              className="size-3.5 shrink-0 text-foreground/20 opacity-0 transition-opacity group-hover/ws:opacity-80"
                            />
                            <ChevronRight className={cn(
                              "size-4 shrink-0 transition-transform duration-200",
                              isViewing ? "text-foreground/45" : "text-foreground/25",
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
                            <div className="ml-5 mt-1.5 mb-1.5 border-l-2 border-foreground/[0.08] pl-3">
                              <WorkspaceFeatureNav
                                order={featureOrder}
                                onReorder={setFeatureOrder}
                                activeId={viewWorkspaceId === agent.id ? activeNav : null}
                                onSelect={(id: WorkspaceFeatureId) => goToWorkspaceNav(id, agent)}
                                badgeFor={id =>
                                  id === "bookmarks" && agent.id === activeWorkspaceId
                                    ? unseenBookmarkIds.size
                                    : 0
                                }
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}

                <div
                  className={cn(
                    "relative shrink-0 transition-[height] duration-100",
                    reorderingWorkspaces ? "h-3.5" : "h-0",
                  )}
                  onDragOver={e => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    updateWsDrop(orderedWorkspaces.length);
                  }}
                  onDrop={commitWsDrop}
                >
                  {reorderingWorkspaces && workspaceDropIndex === orderedWorkspaces.length && (
                    <div
                      role="presentation"
                      className="pointer-events-none absolute inset-x-1 top-1/2 z-30 flex -translate-y-1/2 items-center gap-1.5"
                    >
                      <span className="size-2 shrink-0 rounded-full bg-indigo-400 shadow-[0_0_10px_rgba(129,140,248,0.95)]" />
                      <span className="h-[3px] flex-1 rounded-full bg-indigo-400 shadow-[0_0_12px_rgba(129,140,248,0.85)]" />
                      <span className="size-2 shrink-0 rounded-full bg-indigo-400 shadow-[0_0_10px_rgba(129,140,248,0.95)]" />
                    </div>
                  )}
                </div>
              </>
            );
          })()}
          </div>

        {/* Settings — bottom anchor; menu sheet sits in front of workspaces */}
        <div ref={settingsChromeRef} className="relative shrink-0 border-t border-border bg-sidebar z-20">
          {settingsVisible && (
            <div
              className={cn(
                "absolute bottom-full inset-x-0 z-30 flex flex-col overflow-hidden",
                "rounded-t-xl border border-b-0 border-foreground/12",
                "bg-card dark:bg-zinc-950",
                "shadow-[0_-12px_40px_rgba(0,0,0,0.55)]",
                viewTransition,
                settingsNavExpanded
                  ? "opacity-100 translate-y-0"
                  : "opacity-0 translate-y-2 pointer-events-none",
              )}
              style={{
                height: settingsNavExpanded ? settingsNavHeight.height : 0,
                transition: settingsNavHeight.dragging
                  ? "none"
                  : "height 200ms ease-in-out, opacity 200ms ease-in-out, transform 200ms ease-in-out",
              }}
            >
              {settingsNavExpanded && (
                <PanelResizeHandle
                  edge="top"
                  label="Resize settings panel"
                  active={settingsNavHeight.dragging}
                  onPointerDown={e => settingsNavHeight.startResize("top", e)}
                />
              )}
              <div
                ref={settingsNavContentRef}
                className="flex-1 min-h-0 flex flex-col px-2 pt-2.5 pb-2"
              >
                <SettingsSidebarNav
                  section={settingsSection}
                  onSectionChange={handleSettingsSectionChange}
                  onOpenInsightsDashboard={openInsightsDashboard}
                  activeInsightsDashboard={
                    asUserParam || insightsSubject ? null : (analyticsView ?? null)
                  }
                  isAdmin={
                    !authSession
                    || authSession.role === "super_admin"
                    || authSession.role === "admin"
                  }
                  onSignOut={authSession ? () => void authSession.logout() : undefined}
                />
              </div>
            </div>
          )}

          <div className="px-2.5 pb-3 pt-2.5 space-y-1.5">
            {(!runtimeStatus || !runtimeStatus.chatReady) && (
              <Link
                href={GETTING_STARTED_PATH}
                className={cn(
                  "w-full flex items-center gap-2.5 rounded-xl px-3.5 py-3 text-left",
                  "text-indigo-200 hover:bg-indigo-500/10 hover:text-indigo-100",
                )}
              >
                <BookOpen className="size-4 shrink-0" aria-hidden />
                <span className="text-sm font-medium flex-1">Getting started</span>
              </Link>
            )}
            <button
              type="button"
              onClick={toggleSettings}
              title={settingsNavExpanded ? "Close settings" : "Open settings"}
              aria-expanded={settingsNavExpanded}
              className={cn(
                "w-full min-h-12 flex items-center gap-3 rounded-xl px-4 py-3.5 text-left cursor-pointer",
                viewTransition,
                (activeNav === "settings" && !onAnalytics) || settingsNavExpanded
                  ? "bg-[var(--surface-selected)] text-[var(--primary-soft-foreground)] shadow-[inset_0_0_0_1px_var(--primary-border)] dark:bg-foreground/10 dark:text-foreground/90 dark:shadow-none"
                  : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-foreground dark:text-foreground/70 dark:hover:bg-foreground/10 dark:hover:text-foreground",
              )}
            >
              <Settings className={cn(
                "size-5 shrink-0",
                viewTransition,
                (activeNav === "settings" && !onAnalytics) || settingsNavExpanded
                  ? "text-[var(--primary)] dark:text-foreground/90"
                  : "text-foreground/60 dark:text-foreground/60",
              )} aria-hidden />
              <span className={cn(
                "text-[0.95rem] font-medium flex-1",
                viewTransition,
              )}>Settings</span>
              <ChevronDown className={cn(
                "size-4 shrink-0 ease-in-out",
                viewTransition,
                settingsNavExpanded ? "rotate-180" : "rotate-0",
              )} aria-hidden />
            </button>
          </div>
        </div>
        </div>
      </aside>

      {/* ── Center ───────────────────────────────────────────────────────── */}
      <main className="flex flex-1 min-w-0 flex-col">

        {/* Slim header bar */}
        <div className="flex items-center gap-3 border-b border-foreground/6 px-5 py-3 shrink-0">
          <div className="relative flex flex-1 items-center gap-2.5 min-w-0 min-h-[1.75rem]">
            <div className={cn(
              "flex items-center gap-2.5 min-w-0 w-full ease-in-out",
              viewTransition,
              workContentShown && !settingsHeaderShown
                ? "opacity-100 translate-y-0"
                : "opacity-0 translate-y-1 pointer-events-none absolute inset-0",
            )}>
            {headerWorkNav === "home" ? (
              <h1 className="text-sm font-semibold text-foreground">Home</h1>
            ) : isWorkspaceNav(headerWorkNav) ? (
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
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
                    aria-label="Stop response"
                  >
                    <Square className="size-3 fill-current" aria-hidden />
                    Stop
                  </button>
                )}
                {headerWorkNav === "thread" && totalRedactions > 0 && (
                  <Badge variant="secondary" className="gap-1 h-5 text-[0.65rem] bg-foreground/5 text-foreground/45 border-foreground/8 shrink-0">
                    <ShieldCheck className="size-2.5" aria-hidden />
                    {totalRedactions} redacted
                  </Badge>
                )}
              </>
            ) : (
              <h1 className="text-sm font-semibold text-foreground/70">{navTitle(headerWorkNav)}</h1>
            )}
            </div>
            <div className={cn(
              "flex items-center gap-1.5 min-w-0 text-sm ease-in-out",
              viewTransition,
              settingsHeaderShown
                ? "opacity-100 translate-y-0"
                : "opacity-0 translate-y-1 pointer-events-none absolute inset-0",
            )}>
              <span className="font-semibold text-foreground/85 shrink-0">Settings</span>
              {onAnalytics && insightsSubject ? (
                <>
                  <ChevronRight className="size-3.5 text-foreground/25 shrink-0" aria-hidden />
                  <button
                    type="button"
                    onClick={backToAdminFromInsights}
                    className="text-foreground/55 hover:text-foreground/85 truncate cursor-pointer"
                  >
                    Admin console
                  </button>
                  <ChevronRight className="size-3.5 text-foreground/25 shrink-0" aria-hidden />
                  <span className="text-[var(--warning)] truncate font-medium">{insightsSubject.label}</span>
                  {analyticsTabLabel && (
                    <>
                      <ChevronRight className="size-3.5 text-foreground/25 shrink-0" aria-hidden />
                      <span className="text-foreground/45 truncate">{analyticsTabLabel}</span>
                    </>
                  )}
                </>
              ) : onAnalytics && analyticsTabLabel ? (
                <>
                  <ChevronRight className="size-3.5 text-foreground/25 shrink-0" aria-hidden />
                  <span className="text-foreground/45 truncate">{analyticsTabLabel}</span>
                </>
              ) : settingsSection !== "overview" ? (
                <>
                  <ChevronRight className="size-3.5 text-foreground/25 shrink-0" aria-hidden />
                  <span className="text-foreground/45 truncate">{SETTINGS_SECTION_LABELS[settingsSection]}</span>
                </>
              ) : null}
            </div>
          </div>

          <div className="relative shrink-0 ml-2">
            <details className="group">
              <summary
                className="list-none flex items-center gap-2 cursor-pointer rounded-lg border border-border bg-card px-2 py-1 hover:bg-secondary/80 [&::-webkit-details-marker]:hidden"
                aria-label="Account menu"
              >
                <SessionAvatar size="sm" />
                <span className="hidden sm:inline text-[0.65rem] text-muted-foreground truncate max-w-[8rem]">
                  {authSession?.email ?? "Local user"}
                </span>
                {authSession?.role && (
                  <span
                    className={cn(
                      "text-[0.55rem] uppercase tracking-wide px-1.5 py-0.5 rounded border",
                      authSession.role === "super_admin" || authSession.role === "admin"
                        ? "text-[var(--primary-soft-foreground)] border-[var(--primary-border)] bg-[var(--primary-soft)]"
                        : "text-muted-foreground border-border bg-secondary",
                    )}
                  >
                    {authSession.role}
                  </span>
                )}
              </summary>
              <div className="absolute right-0 top-full mt-1 z-50 min-w-[11rem] rounded-xl border border-border bg-popover p-1 shadow-lg">
                <button
                  type="button"
                  className="w-full text-left rounded-lg px-3 py-2 text-[0.75rem] text-foreground/80 hover:bg-secondary cursor-pointer"
                  onClick={() => openSettings("profile")}
                >
                  My Profile
                </button>
                {authSession && (
                  <button
                    type="button"
                    className="w-full text-left rounded-lg px-3 py-2 text-[0.75rem] text-foreground/80 hover:bg-secondary cursor-pointer"
                    onClick={() => void authSession.logout()}
                  >
                    Sign out
                  </button>
                )}
              </div>
            </details>
          </div>

          {/* Mobile intelligence sheet — hidden on full analytics views */}
          {!isAnalytics && (
          <Sheet>
            <SheetTrigger
              className={cn(
                buttonVariants({ variant: "outline", size: "sm", className: "h-7 text-xs gap-1.5 lg:hidden shrink-0 border-foreground/10 bg-foreground/4" }),
              )}
            >
              <Sparkles className="size-3.5" aria-hidden />
              Intel
            </SheetTrigger>
            <SheetContent side="right" className="w-full sm:max-w-sm flex flex-col p-0 bg-sidebar border-foreground/8">
              <SheetHeader className="px-5 pt-5 pb-4 border-b border-foreground/6 shrink-0">
                <SheetTitle className="text-section tracking-tight">Insights</SheetTitle>
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
                workspaces={
                  insightsSubject
                    ? subjectWorkspaces
                    : workspaces.map(w => ({ id: w.id, name: w.name, emoji: w.emoji }))
                }
                subject={insightsSubject}
                onBackToAdmin={insightsSubject ? backToAdminFromInsights : undefined}
                onEditPolicy={() => returnToSettingsSection("workspace")}
                onOpenSafeTerms={() => returnToSettingsSection("workspace")}
                currentPolicyTier={piiSensitivity}
                onSelectPolicyTier={
                  canEditSecurity || !authSession
                    ? (tier) => { void setPiiSensitivity(tier); }
                    : undefined
                }
                detectionLog={mergedPiiEntries.flatMap(entry =>
                  entry.redactions.map(rec => ({
                    rec,
                    entry: {
                      at: entry.at,
                      turn: entry.turn,
                      workspaceId: entry.workspaceId,
                      source: entry.source,
                      documentName: entry.documentName,
                    },
                  })),
                )}
                dismissedDetectionIds={[...dismissedPiiIds]}
                onDismissDetection={dismissPiiRecord}
                onDeleteDetection={deletePiiRecord}
              />
            )}
            {analyticsView === "usage" && (
              <UsageAnalyticsView
                workspaces={
                  insightsSubject
                    ? subjectWorkspaces
                    : workspaces.map(w => ({ id: w.id, name: w.name }))
                }
                subject={insightsSubject}
                onBackToAdmin={insightsSubject ? backToAdminFromInsights : undefined}
              />
            )}
            {analyticsView === "cost" && (
              <CostAnalyticsView
                workspaces={
                  insightsSubject
                    ? subjectWorkspaces
                    : workspaces.map(w => ({ id: w.id, name: w.name }))
                }
                subject={insightsSubject}
                onBackToAdmin={insightsSubject ? backToAdminFromInsights : undefined}
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
                    <p className="text-[0.7rem] text-foreground/30 mt-0.5 px-1.5">
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

              <div className="rounded-xl border border-foreground/[0.06] bg-foreground/[0.02] px-4 py-3">
                <p className="text-sm text-foreground/50 leading-relaxed">
                  Saved conclusions and pinned answers from investigations in{" "}
                  <span className="text-foreground/70 font-medium">{viewWorkspace?.name ?? "this workspace"}</span>.
                  {" "}Open one to jump back to that moment in the thread.
                </p>
              </div>

              {viewBookmarks.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-foreground/10 px-5 py-10 text-center space-y-3">
                  <Bookmark className="size-8 text-amber-400/25 mx-auto" aria-hidden />
                  <p className="text-sm font-medium text-foreground/50">No saved conclusions yet</p>
                  <p className="text-xs text-foreground/30 leading-relaxed max-w-sm mx-auto">
                    Open Chat, hover any answer, and tap the bookmark icon to save it here.
                  </p>
                </div>
              ) : (
                groupedViewBookmarks.map(group => (
                  <section key={group.dayKey}>
                    <h3 className="sticky top-0 z-[1] -mx-1 mb-2.5 px-1 py-1.5 text-[0.65rem] uppercase tracking-[0.22em] text-foreground/30 font-semibold backdrop-blur-sm bg-card/80">
                      {group.label}
                      <span className="ml-2 normal-case tracking-normal text-foreground/20 font-normal">
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
                    <p className="text-[0.7rem] text-foreground/30 mt-0.5 px-1.5">
                      {viewWorkspaceId === activeWorkspaceId
                        ? "What this workspace has retained about you"
                        : `Viewing ${viewWorkspaceName}'s saved memory`}
                    </p>
                  ) : (
                    <p className="text-[0.7rem] text-foreground/30 mt-0.5 px-1.5 animate-pulse">Syncing…</p>
                  )
                }
              />
              <MemoryDashboard
                workspaceName={viewWorkspaceName}
                workspaceFacts={workspaceFacts}
                sessionSummaries={allSessionSummaries}
                liveSessionSummary={viewWorkspaceId === activeWorkspaceId ? sessionSummary : ""}
                liveFacts={viewWorkspaceId === activeWorkspaceId ? extractedFacts : {}}
                memoryLoading={memoryLoading}
                memoryStats={memoryStats}
                isActiveWorkspace={viewWorkspaceId === activeWorkspaceId}
                messageCount={messages.length}
                summarizedCount={summarizedCount}
                onFactPatch={async (factId, patch) => {
                  if (!viewWorkspaceId) return;
                  const res = await fetch(`/api/memory/facts/${factId}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ workspaceId: viewWorkspaceId, ...patch }),
                  });
                  if (!res.ok) return;
                  const updated = await res.json() as WorkspaceFactRecord;
                  setWorkspaceFacts(prev => prev.map(f => f.id === factId ? { ...f, ...updated } : f));
                }}
                onFactDelete={async (factId) => {
                  if (!viewWorkspaceId) return;
                  const res = await fetch(`/api/memory/facts/${factId}?workspaceId=${viewWorkspaceId}`, {
                    method: "DELETE",
                  });
                  if (res.ok || res.status === 204) {
                    setWorkspaceFacts(prev => prev.filter(f => f.id !== factId));
                  }
                }}
              />
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
                    <p className="text-[0.7rem] text-foreground/30 mt-0.5 px-1.5">
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
              <KnowledgeDetail
                doc={selectedDoc}
                onBack={() => setSelectedDoc(null)}
                onDelete={() => deleteDocument(selectedDoc.id)}
                onReprocess={() => reprocessDocument(selectedDoc.id)}
              />
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
                      <p className="text-[0.7rem] text-foreground/30 mt-0.5 px-1.5">
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

                <p className="text-sm text-foreground/45 px-1">
                  {runtimeStatus?.edition === "cloud"
                    ? `Files for ${viewWorkspace?.name ?? "this workspace"} — only extracted, scanned text is stored. Original files are not kept on this install.`
                    : `Files for ${viewWorkspace?.name ?? "this workspace"} — originals kept locally; extracted text is scanned, then indexed.`}
                </p>
                {documents.length > 0 && (
                  <KnowledgeLibraryFilters
                    value={knowledgeFilter}
                    onChange={setKnowledgeFilter}
                    counts={{
                      all: documents.length,
                      documents: documents.filter(d => knowledgeLibraryKind(d.mimeType) === "documents").length,
                      spreadsheets: documents.filter(d => knowledgeLibraryKind(d.mimeType) === "spreadsheets").length,
                      images: documents.filter(d => knowledgeLibraryKind(d.mimeType) === "images").length,
                    }}
                  />
                )}

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
                  <div className="flex items-center gap-2 text-sm text-foreground/30 animate-pulse">
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
                    <div className="rounded-2xl bg-foreground/[0.04] border border-indigo-500/20 p-4 animate-pulse flex flex-col gap-2">
                      <div className="h-4 w-12 rounded bg-foreground/10" />
                      <div className="h-3 w-3/4 rounded bg-foreground/8 mt-1" />
                      <div className="h-3 w-1/2 rounded bg-foreground/6" />
                      {documents.length === 0 && (
                        <>
                          <div className="h-8 w-full rounded bg-foreground/4 mt-2" />
                          <div className="h-3 w-1/3 rounded bg-foreground/5 mt-1" />
                        </>
                      )}
                    </div>
                  </div>
                )}

                {!docLoading && !docUploading && documents.length === 0 && (
                  <div className="text-center pb-4">
                    <p className="text-xs text-foreground/25 leading-relaxed max-w-md mx-auto">
                      Drop a file or use Upload. Max {MAX_FILE_MB} MB. Text is extracted, scanned for known patterns, then indexed.
                    </p>
                  </div>
                )}

                {documents.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {documents
                      .filter(doc =>
                        knowledgeFilter === "all" || knowledgeLibraryKind(doc.mimeType) === knowledgeFilter,
                      )
                      .map(doc => (
                      <DocumentCard
                        key={doc.id}
                        doc={doc}
                        onOpen={() => openDocDetail(doc.id)}
                        onDelete={() => deleteDocument(doc.id)}
                        onRetry={() => reprocessDocument(doc.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

        ) : workNav === "home" ? (
          <div className="flex-1 overflow-y-auto px-5 py-8">
            <div className="max-w-2xl mx-auto space-y-6">
              <div>
                <p className="text-[0.65rem] uppercase tracking-[0.2em] text-[var(--primary-soft-foreground)] font-semibold">
                  SecureMind
                </p>
                <h2 className="text-display mt-1.5 tracking-tight">
                  Home
                </h2>
                <p className="text-body mt-2.5 text-[var(--text-muted)]">
                  {PRODUCT_POSITIONING} Pick up where you left off
                  {viewWorkspace ? (
                    <>
                      {" "}in{" "}
                      <span className="text-foreground font-medium">{viewWorkspace.name}</span>
                    </>
                  ) : null}
                  .
                </p>
              </div>

              {(!runtimeStatus || !runtimeStatus.chatReady) && (
                <Link
                  href={GETTING_STARTED_PATH}
                  className="block rounded-xl border border-indigo-400/35 bg-indigo-500/[0.08] p-4 hover:bg-indigo-500/[0.12] transition-colors"
                >
                  <span className="flex size-9 items-center justify-center rounded-lg bg-indigo-500/20 border border-indigo-400/30">
                    <BookOpen className="size-4 text-indigo-200" aria-hidden />
                  </span>
                  <p className="mt-3 text-sm font-semibold text-foreground">Getting started</p>
                  <p className="mt-1 text-xs text-[var(--text-muted)] leading-relaxed">
                    Pictures of each click: open Providers, check the Bedrock billing box, enable the model in the AWS console, then come back to chat.
                  </p>
                </Link>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                {([
                  {
                    id: "thread" as const,
                    label: "Chat",
                    hint: "Investigate with citations from Knowledge",
                    icon: MessageSquare,
                  },
                  {
                    id: "documents" as const,
                    label: "Knowledge",
                    hint: "Upload and search workspace documents",
                    icon: FileText,
                  },
                  {
                    id: "memory" as const,
                    label: "Memory",
                    hint: "Facts and summaries you authored",
                    icon: Brain,
                  },
                  {
                    id: "bookmarks" as const,
                    label: "Saved",
                    hint: "Pinned conclusions from the thread",
                    icon: Bookmark,
                  },
                ]).map(item => {
                  const Icon = item.icon;
                  const agent =
                    workspaces.find(w => w.id === (viewWorkspaceId || activeWorkspaceId))
                    ?? workspaces[0];
                  return (
                    <button
                      key={item.id}
                      type="button"
                      disabled={!agent}
                      onClick={() => agent && goToWorkspaceNav(item.id, agent)}
                      className={cn(
                        "rounded-xl border border-border bg-card p-4 text-left shadow-[var(--shadow-sm)]",
                        "hover:border-[var(--primary-border)] hover:bg-[var(--surface-selected)]",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        "cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-colors",
                      )}
                    >
                      <span className="flex size-9 items-center justify-center rounded-lg bg-[var(--primary-soft)] border border-[var(--primary-border)]">
                        <Icon className="size-4 text-[var(--primary-soft-foreground)]" aria-hidden />
                      </span>
                      <p className="mt-3 text-sm font-semibold text-foreground">{item.label}</p>
                      <p className="mt-1 text-[0.72rem] text-muted-foreground leading-relaxed">
                        {item.hint}
                      </p>
                    </button>
                  );
                })}
              </div>

              <div className="rounded-xl border border-border bg-secondary/70 px-4 py-3">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Insights (Models, Security, Cost) stay in the right rail. Open Settings anytime from the
                  sidebar for appearance, providers, and workspace preferences.
                </p>
              </div>
            </div>
          </div>
        ) : (
          /* Thread view */
          <div className="flex flex-1 min-h-0 flex-col">
            {/* Scrollable thread — ChatGPT-style */}
            <div
              ref={threadRef}
              className="flex-1 overflow-y-auto overflow-x-hidden relative"
            >
              {/* Floating date pill — appears when scrolled into historical messages */}
              {floatingDate && (
                <div className="sticky top-3 z-10 flex justify-center pointer-events-none">
                  <span className="rounded-full bg-popover/95 border border-foreground/10 text-[0.65rem] text-foreground/50 px-3 py-1 backdrop-blur-sm shadow-lg">
                    {floatingDate}
                  </span>
                </div>
              )}
              <div className="max-w-4xl mx-auto px-5 py-8 flex flex-col gap-6">
                {sessionLoading && messages.length === 0 ? (
                  <div className="flex items-center gap-2 text-foreground/30 text-sm">
                    <Loader2 className="size-4 animate-spin shrink-0" aria-hidden />
                    <span>Loading conversation…</span>
                  </div>
                ) : (
                  <>
                    {sessionLoading && (
                      <div className="flex items-center gap-2 text-foreground/25 text-xs -mb-3">
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
                            <div className="flex-1 h-px bg-foreground/[0.06]" />
                            <span suppressHydrationWarning className="text-[0.65rem] text-foreground/30 px-1 shrink-0 select-none">
                              {dividerLabel}
                            </span>
                            <div className="flex-1 h-px bg-foreground/[0.06]" />
                          </div>
                        )}
                        <MessageBubble
                          message={msg}
                          workspaceName={workspaceName}
                          workspaceEmoji={activeWorkspace?.emoji}
                          workspaceColor={activeWorkspace?.color}
                          onBookmark={toggleBookmark}
                          onOpenSettings={openSettings}
                          highlighted={highlightedMessageId === msg.id}
                          isThinking={
                            isStreaming &&
                            msg.id === streamingMessageId &&
                            msg.role === "assistant" &&
                            !msg.content &&
                            !msg.error
                          }
                          thinkingStartedAt={streamStartedAt ?? undefined}
                          onStopThinking={cancelStream}
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
              className="shrink-0 px-5 pt-3 pb-9 border-t border-foreground/5"
              onDragEnter={handleComposerDragEnter}
              onDragLeave={handleComposerDragLeave}
              onDragOver={handleComposerDragOver}
              onDrop={handleComposerDrop}
            >
              <form
                onSubmit={e => { e.preventDefault(); void handleSend(); }}
                className="max-w-4xl mx-auto relative"
              >
                {vendorRiskBlocked && activeNav === "thread" && runtimeStatus?.chatReady && (
                  <div
                    role="status"
                    className="mb-2 flex flex-wrap items-start justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-100/90"
                  >
                    <div className="min-w-0 space-y-1">
                      <p className="font-medium text-amber-50/95">
                        Vendor APIs are off — tier models (Groq) will not run
                      </p>
                      <p className="text-[0.7rem] text-amber-100/70 leading-relaxed">
                        A Groq key is configured, but the risk acknowledgment in Settings is unchecked.
                        Chat falls back to Ollama/Bedrock only; multi-tier Groq routing stays disabled
                        until you accept vendor API terms.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => openSettings("inference")}
                      className="shrink-0 rounded-lg border border-amber-400/35 bg-amber-500/15 px-2.5 py-1.5 text-[0.7rem] font-medium text-amber-50 hover:bg-amber-500/25 cursor-pointer"
                    >
                      Open Models
                    </button>
                  </div>
                )}

                {runtimeStatus && (
                  <>
                    <RuntimeStatusBar
                      status={runtimeStatus}
                      inUseLabel={composerInUseLabel}
                      inUseProvider={composerInUseProvider}
                    />
                    <ModelSetupPanel
                      status={runtimeStatus}
                      onOpenSettings={openSettings}
                      onPulled={() => void refreshRuntimeStatus()}
                    />
                  </>
                )}

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
                      <div key={f.name + f.size} className="flex items-center gap-1.5 rounded-lg bg-foreground/6 border border-foreground/8 px-2.5 py-1 text-xs text-foreground/60">
                        <span className="truncate max-w-[140px]">{f.name}</span>
                        <span className="text-foreground/25 text-[0.6rem]">
                          {f.type.startsWith("image/") ? "image + Knowledge" : "adds to Knowledge"}
                        </span>
                        <button type="button" onClick={() => removeAttachment(f.name)} className="text-foreground/30 hover:text-foreground/60">✕</button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Emoji picker popover */}
                {showEmoji && (
                  <div ref={emojiPickerRef} className="absolute bottom-24 left-1/2 -translate-x-1/2 z-50 shadow-2xl rounded-2xl overflow-hidden">
                    <EmojiPicker
                      theme={appearanceTheme === "dark" ? Theme.DARK : Theme.LIGHT}
                      onEmojiClick={onEmojiClick}
                      lazyLoadEmojis
                      searchPlaceholder="Search emoji…"
                      height={380}
                      width={320}
                    />
                  </div>
                )}

                <div className={cn(
                  "rounded-2xl border transition-all shadow-[var(--shadow-md)] overflow-hidden relative",
                  composerDragOver
                    ? "bg-[var(--primary-soft)] border-[var(--primary-border)] ring-2 ring-[var(--primary-border)]"
                    : listening
                      ? "bg-secondary border-[var(--primary-border)]"
                      : "bg-secondary border-foreground/32 focus-within:border-[var(--primary-border)] focus-within:ring-2 focus-within:ring-ring/30",
                )}>
                  {composerDragOver && (
                    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1.5 bg-overlay pointer-events-none">
                      <Upload className="size-6 text-primary-foreground" aria-hidden />
                      <p className="text-sm font-medium text-primary-foreground">Drop to attach</p>
                      <p className="text-[0.65rem] text-primary-foreground/80">Saved to Knowledge when you send</p>
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
                      error={voiceError}
                      provider={parseVoiceSttChoice(runtimeStatus?.capabilities.voiceStt?.provider)}
                      onCancel={cancelVoice}
                      onConfirm={confirmVoice}
                    />
                  ) : (
                    <>
                    {voiceError && (
                      <p className="px-4 pt-2 text-[0.72rem] text-red-300/85 leading-relaxed">
                        {voiceError}
                      </p>
                    )}
                    <ComposerInput
                      ref={composerRef}
                      workspaceName={workspaceName}
                      sessionLoading={sessionLoading}
                      sessionReady={sessionReady}
                      isStreaming={isStreaming}
                      isSending={sendInFlight}
                      hasAttachments={attachments.length > 0}
                      inferenceReady
                      voiceReady
                      voiceTitle={
                        parseVoiceSttChoice(runtimeStatus?.capabilities.voiceStt?.provider) === "transcribe"
                          ? "Dictate with Amazon Transcribe"
                          : parseVoiceSttChoice(runtimeStatus?.capabilities.voiceStt?.provider) === "groq"
                            ? "Dictate with Groq Whisper"
                            : "Set up voice transcription"
                      }
                      voiceBlockedReason={runtimeStatus?.capabilities.voiceStt?.note}
                      voiceInsert={voiceComposerInsert}
                      onVoiceInsertApplied={() => setVoiceComposerInsert(null)}
                      onSend={() => { void handleSend(); }}
                      onCancelStream={cancelStream}
                      onStartVoice={startVoice}
                      onComposerFocus={() => warmChatConnection()}
                    />
                    </>
                  )} {/* end of non-listening branch */}

                  {/* Toolbar row */}
                  <div className="flex items-center gap-1 px-3 pb-2.5 border-t border-foreground/5 pt-2">
                    {/* Emoji */}
                    <button
                      ref={emojiBtnRef}
                      type="button"
                      onClick={() => setShowEmoji(p => !p)}
                      title="Emoji"
                      className={cn(
                        "flex items-center justify-center size-7 rounded-lg text-base transition-colors",
                        showEmoji ? "bg-foreground/10 text-foreground/80" : "text-foreground/30 hover:text-foreground/70 hover:bg-foreground/6",
                      )}
                    >
                      😊
                    </button>

                    {/* Attach file */}
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      title="Attach file or image"
                      className="flex items-center justify-center size-7 rounded-lg text-foreground/30 hover:text-foreground/70 hover:bg-foreground/6 transition-colors"
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
                      className="flex items-center justify-center size-7 rounded-lg text-foreground/30 hover:text-foreground/70 hover:bg-foreground/6 transition-colors"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4">
                        <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>
                      </svg>
                    </button>

                    <div className="flex-1" />
                  </div>
                </div>

                <p className="mt-2.5 text-center text-[0.65rem] leading-relaxed text-[var(--text-secondary)] select-none px-2">
                  Drop files or use the paperclip — read in this chat and saved to Knowledge (duplicates reused). Detected sensitive text is replaced first (best-effort).
                  <span className="block text-[var(--text-muted)] mt-0.5">{ATTACHMENT_LIMITS_HINT}</span>
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
                onOpenUserInsights={(subject) => openInsightsDashboard("usage", subject)}
                safeTerms={safeTerms}
                onAddSafeTerm={addSafeTerm}
                onRemoveSafeTerm={removeSafeTerm}
                piiSensitivity={piiSensitivity}
                onPiiSensitivityChange={(tier) => { void setPiiSensitivity(tier); }}
                canEditSecurity={canEditSecurity || !authSession}
                securityPending={securityPending}
                onProposeSecurity={(tier) => { void proposeSecurity(tier); }}
                onAcceptPendingSecurity={() => { void acceptPendingSecurity(); }}
                onDismissPendingSecurity={() => { void dismissPendingSecurity(); }}
                securityNotice={securityNotice}
                savingsStats={savingsStats}
                totalRouteCalls={totalRouteCalls}
                totalPiiActive={totalPiiFiltered}
                lastRouteLabel={lastRouteInfo
                  ? `${labelFor(lastRouteInfo.model)} via ${lastRouteInfo.provider === "ollama" ? "Ollama" : lastRouteInfo.provider}`
                  : ""}
                activeMode={mode}
                complexityTiers={complexityTiersBind}
                isAdmin={
                  !authSession
                  || authSession.role === "super_admin"
                  || authSession.role === "admin"
                }
                actorRole={authSession?.role ?? "super_admin"}
                onProvidersChanged={() => { void refreshRuntimeStatus(); }}
              />
            )}
          </div>
        </div>
      </main>

      {/* ── Intel panel separator + collapse toggle (desktop) ───────────── */}
      {!isAnalytics && (
      <div className="hidden lg:flex items-stretch relative shrink-0 z-20">
        <div
          className={cn(
            "w-px h-full transition-colors",
            rightSidebar.dragging ? "bg-indigo-400/60" : "bg-foreground/6",
          )}
        />
        {/* Drag the separator edge to widen/narrow the Insights rail */}
        {isIntelOpen && (
          <SidebarResizeHandle
            edge="left"
            label="Resize insights sidebar"
            active={rightSidebar.dragging}
            onPointerDown={e => rightSidebar.startResize("left", e)}
          />
        )}
        {/* Button anchored to the LEFT of the separator — always fully visible */}
        <button
          onClick={() => setIsIntelOpen(p => !p)}
          title={isIntelOpen ? "Collapse panel" : "Expand panel"}
          aria-label={isIntelOpen ? "Collapse intelligence panel" : "Expand intelligence panel"}
          className={cn(
            "absolute top-1/2 -translate-y-1/2 z-40",
            "flex size-10 items-center justify-center",
            "rounded-full border-2 bg-card",
            "transition-all duration-300",
            isIntelOpen
              ? "right-0 translate-x-1/2 border-foreground/10 text-foreground/30 hover:border-foreground/25 hover:text-foreground/70 hover:bg-foreground/8"
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
      <aside
        className={cn(
          "hidden lg:flex shrink-0 flex-col bg-secondary border-l border-[var(--border-strong)] dark:bg-sidebar dark:border-transparent overflow-hidden",
          !rightSidebar.dragging && "transition-[width,opacity] duration-300 ease-in-out",
          isIntelOpen ? "opacity-100" : "opacity-0",
        )}
        style={{ width: isIntelOpen ? rightSidebar.width : 0 }}
      >
        <div
          className={cn(
            "flex-1 min-h-0 px-4 py-5 overflow-hidden flex flex-col",
            "transition-opacity duration-200",
            !isIntelOpen && "pointer-events-none",
          )}
          style={{ width: rightSidebar.width }}
        >
          {IntelligencePanel}
        </div>
      </aside>
      )}
    </div>
  );
}

