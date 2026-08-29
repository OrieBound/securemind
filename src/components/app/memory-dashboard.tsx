"use client";

import {
  Brain,
  ChevronDown,
  Layers,
  Loader2,
  MessageSquare,
  User,
} from "lucide-react";
import { useMemo, useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { formatFactValue, humanizeKey } from "@/lib/memory/format";
import { buildFactAssociations, categoryLabel as factCategoryLabel, type FactAssociation } from "@/lib/memory/fact-graph";

// ─── types ────────────────────────────────────────────────────────────────────

export type MemoryFactRecord = {
  id: string;
  key: string;
  value: string;
  confidence: number;
  source: string | null;
  updatedAt: string;
  pinned?: boolean;
  forgotten?: boolean;
};

export type MemorySummaryRecord = {
  id: string;
  summary: string;
  turnsCovered: number;
  updatedAt: string;
  session: { id: string; createdAt: string };
};

export type MemoryStats = {
  semanticFragmentCount: number;
  documentFragmentCount: number;
};

type SummaryPeriod = "day" | "month" | "year";
type LayerId = "working" | "summary" | "facts" | "semantic" | "episodic";

// ─── fact helpers ─────────────────────────────────────────────────────────────

const IDENTITY_KEYS = new Set([
  "name",
  "age",
  "occupation",
  "location",
  "project",
  "projects",
  "goals",
  "skills",
  "interests",
]);

type MemoryTab = "overview" | "facts" | "archive";

const MEMORY_TABS: { id: MemoryTab; label: string; icon: typeof Brain }[] = [
  { id: "overview", label: "Overview", icon: Brain },
  { id: "facts", label: "Facts", icon: Layers },
  { id: "archive", label: "Archive", icon: MessageSquare },
];

function confidenceColor(c: number): string {
  if (c >= 0.85) return "bg-emerald-400";
  if (c >= 0.6) return "bg-amber-400";
  return "bg-red-400/80";
}

function groupSummaries(
  items: MemorySummaryRecord[],
  period: SummaryPeriod,
): { key: string; label: string; items: MemorySummaryRecord[] }[] {
  const map = new Map<string, { label: string; items: MemorySummaryRecord[] }>();
  for (const item of items) {
    const d = new Date(item.session.createdAt);
    let key: string;
    let label: string;
    if (period === "day") {
      key = d.toDateString();
      label = formatDayLabel(d);
    } else if (period === "month") {
      key = `${d.getFullYear()}-${d.getMonth()}`;
      label = d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    } else {
      key = String(d.getFullYear());
      label = String(d.getFullYear());
    }
    if (!map.has(key)) map.set(key, { label, items: [] });
    map.get(key)!.items.push(item);
  }
  return [...map.entries()]
    .sort((a, b) => new Date(b[1].items[0]!.session.createdAt).getTime() - new Date(a[1].items[0]!.session.createdAt).getTime())
    .map(([key, v]) => ({ key, ...v }));
}

function formatDayLabel(d: Date): string {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", year: "numeric" });
}

function mergeLiveFacts(
  workspaceFacts: MemoryFactRecord[],
  liveFacts: Record<string, string>,
): MemoryFactRecord[] {
  const byKey = new Map<string, MemoryFactRecord>();
  for (const f of workspaceFacts) byKey.set(f.key.toLowerCase(), f);
  for (const [k, v] of Object.entries(liveFacts)) {
    byKey.set(k.toLowerCase(), {
      id: `live-${k}`,
      key: k,
      value: typeof v === "string" ? v : formatFactValue(v),
      confidence: 0.75,
      source: null,
      updatedAt: new Date().toISOString(),
    });
  }
  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}

// ─── sub-components ───────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  hint,
  accent = "indigo",
}: {
  label: string;
  value: string | number;
  hint?: string;
  accent?: "indigo" | "violet" | "emerald" | "amber";
}) {
  const ring = {
    indigo:  "border-indigo-500/20 bg-indigo-500/[0.06]",
    violet:  "border-violet-500/20 bg-violet-500/[0.06]",
    emerald: "border-emerald-500/20 bg-emerald-500/[0.06]",
    amber:   "border-amber-500/20 bg-amber-500/[0.06]",
  }[accent];
  return (
    <div className={cn("rounded-xl border px-3.5 py-3", ring)}>
      <p className="text-[0.62rem] uppercase tracking-[0.18em] text-foreground/35 font-semibold">{label}</p>
      <p className="text-xl font-bold text-foreground/90 tabular-nums mt-1">{value}</p>
      {hint && <p className="text-[0.65rem] text-foreground/30 mt-0.5">{hint}</p>}
    </div>
  );
}

function FactRow({
  fact,
  live,
  selected,
  onSelect,
}: {
  fact: MemoryFactRecord;
  live?: boolean;
  selected?: boolean;
  onSelect?: (fact: MemoryFactRecord) => void;
}) {
  const display = formatFactValue(fact.value);
  if (display === "—") return null;
  const interactive = !!onSelect;
  const Wrapper = interactive ? "button" : "div";
  return (
    <Wrapper
      type={interactive ? "button" : undefined}
      onClick={interactive ? () => onSelect!(fact) : undefined}
      className={cn(
        "flex items-start gap-3 px-4 py-3 w-full text-left transition-colors",
        interactive && "cursor-pointer hover:bg-foreground/[0.04]",
        selected && "bg-indigo-500/[0.08]",
      )}
    >
      <span className={cn(
        "mt-1.5 size-1.5 rounded-full shrink-0",
        live ? "bg-indigo-400 animate-pulse" : confidenceColor(fact.confidence),
      )} />
      <div className="flex-1 min-w-0">
        <p className="text-[0.68rem] text-foreground/35 capitalize">{humanizeKey(fact.key)}</p>
        <p className="text-sm text-foreground/82 font-medium leading-snug mt-0.5 break-words">{display}</p>
      </div>
      <div className="text-right shrink-0">
        {live ? (
          <span className="text-[0.58rem] uppercase tracking-wider text-indigo-400/80 font-bold">Live</span>
        ) : (
          <span className="text-[0.6rem] text-foreground/25 tabular-nums">{Math.round(fact.confidence * 100)}%</span>
        )}
      </div>
    </Wrapper>
  );
}

function FactCard({
  assoc,
  selected,
  onSelect,
}: {
  assoc: FactAssociation;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "rounded-xl border px-3.5 py-3 text-left transition-colors cursor-pointer w-full",
        selected
          ? "border-indigo-400/35 bg-indigo-500/[0.1]"
          : "border-foreground/[0.07] bg-foreground/[0.025] hover:border-foreground/12 hover:bg-foreground/[0.04]",
      )}
    >
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="text-[0.62rem] uppercase tracking-wider text-foreground/35 font-semibold">
          {humanizeKey(assoc.key)}
        </span>
        <span className={cn(
          "text-[0.58rem] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded",
          assoc.category === "behavioral" && "text-rose-300/70 bg-rose-500/10",
          assoc.category === "identity" && "text-emerald-300/70 bg-emerald-500/10",
          assoc.category === "other" && "text-foreground/30 bg-foreground/[0.06]",
        )}>
          {factCategoryLabel(assoc.category)}
        </span>
      </div>
      <p className="text-sm text-foreground/75 font-medium leading-snug line-clamp-2">{assoc.value}</p>
      <p className="text-[0.62rem] text-foreground/25 mt-2">
        {assoc.relatedSummaries.length} linked · {assoc.relatedFacts.length} related
      </p>
    </button>
  );
}

function FactDetailPanel({
  assoc,
  fact,
  onPatch,
  onDelete,
}: {
  assoc: FactAssociation;
  fact?: MemoryFactRecord;
  onPatch?: (factId: string, patch: { value?: string; pinned?: boolean; forgotten?: boolean }) => void;
  onDelete?: (factId: string) => void;
}) {
  return (
    <div className="rounded-2xl border border-foreground/[0.08] bg-foreground/[0.03] overflow-hidden">
      <div className="px-4 py-4 border-b border-foreground/[0.06] bg-indigo-500/[0.04]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[0.65rem] uppercase tracking-wider text-foreground/35 font-semibold">
              {humanizeKey(assoc.key)}
            </p>
            <p className="text-lg font-semibold text-foreground/90 mt-1 leading-snug">{assoc.value}</p>
          </div>
          <span className={cn(
            "text-[0.58rem] uppercase tracking-wider font-bold px-2 py-1 rounded-md shrink-0",
            assoc.live ? "text-indigo-300 bg-indigo-500/15" : "text-foreground/35 bg-foreground/[0.06]",
          )}>
            {assoc.live ? "Live" : `${Math.round(assoc.confidence * 100)}%`}
          </span>
        </div>
        <p className="text-[0.68rem] text-foreground/30 mt-2">
          {factCategoryLabel(assoc.category)} · Updated {new Date(assoc.updatedAt).toLocaleDateString(undefined, {
            month: "short", day: "numeric", year: "numeric",
          })}
          {fact?.pinned ? " · Pinned" : ""}
          {fact?.forgotten ? " · Forgotten" : ""}
        </p>
        {fact && !fact.id.startsWith("live-") && (onPatch || onDelete) && (
          <FactActions fact={fact} onPatch={onPatch} onDelete={onDelete} />
        )}
      </div>

      <div className="px-4 py-4 space-y-5">
        <section>
          <h4 className="text-[0.62rem] uppercase tracking-[0.18em] text-foreground/30 font-semibold mb-2.5">
            Conversation links
          </h4>
          {assoc.relatedSummaries.length === 0 ? (
            <p className="text-sm text-foreground/30 italic">
              No direct summary match yet — this fact may come from live extraction or broader context.
            </p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {assoc.relatedSummaries.map(s => (
                <div key={s.id} className="rounded-lg border border-foreground/[0.06] bg-foreground/[0.05] px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="text-[0.6rem] text-foreground/28 uppercase tracking-wider">
                      {s.id === "live-session" ? "Current session" : `${s.turnsCovered} turns`}
                    </span>
                    <span className="text-[0.6rem] text-foreground/22 tabular-nums">
                      {new Date(s.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </span>
                  </div>
                  <p className="text-[0.78rem] text-foreground/50 leading-relaxed">{s.excerpt}</p>
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <h4 className="text-[0.62rem] uppercase tracking-[0.18em] text-foreground/30 font-semibold mb-2.5">
            Related facts
          </h4>
          {assoc.relatedFacts.length === 0 ? (
            <p className="text-sm text-foreground/30 italic">No closely related facts yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {assoc.relatedFacts.map(rf => (
                <div key={rf.key} className="flex items-start gap-2 rounded-lg border border-foreground/[0.05] px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-[0.65rem] text-foreground/35 capitalize">{humanizeKey(rf.key)}</p>
                    <p className="text-sm text-foreground/65 mt-0.5">{rf.value}</p>
                  </div>
                  <span className="text-[0.58rem] text-foreground/22 shrink-0 max-w-[5rem] text-right leading-tight">
                    {rf.reason}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function FactActions({
  fact,
  onPatch,
  onDelete,
}: {
  fact: MemoryFactRecord;
  onPatch?: (factId: string, patch: { value?: string; pinned?: boolean; forgotten?: boolean }) => void;
  onDelete?: (factId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(fact.value);

  return (
    <div className="mt-3 flex flex-col gap-2">
      {editing ? (
        <div className="flex flex-col gap-2">
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            className="w-full min-h-[4rem] rounded-lg border border-foreground/10 bg-background/40 px-3 py-2 text-sm text-foreground/80"
          />
          <div className="flex gap-2">
            <button
              type="button"
              className="text-[0.72rem] px-2 py-1 rounded-md bg-indigo-500/20 text-indigo-100"
              onClick={() => {
                onPatch?.(fact.id, { value: draft });
                setEditing(false);
              }}
            >
              Save correction
            </button>
            <button type="button" className="text-[0.72rem] text-foreground/40" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="text-[0.68rem] text-indigo-200/80 hover:text-indigo-100" onClick={() => setEditing(true)}>
            Correct
          </button>
          <button
            type="button"
            className="text-[0.68rem] text-foreground/45 hover:text-foreground/70"
            onClick={() => onPatch?.(fact.id, { pinned: !fact.pinned })}
          >
            {fact.pinned ? "Unpin" : "Pin"}
          </button>
          <button
            type="button"
            className="text-[0.68rem] text-foreground/45 hover:text-foreground/70"
            onClick={() => onPatch?.(fact.id, { forgotten: !fact.forgotten })}
          >
            {fact.forgotten ? "Restore" : "Forget"}
          </button>
          <button
            type="button"
            className="text-[0.68rem] text-red-300/70 hover:text-red-300"
            onClick={() => onDelete?.(fact.id)}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

function MemoryTabBar({
  tab,
  onTabChange,
}: {
  tab: MemoryTab;
  onTabChange: (t: MemoryTab) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Memory sections"
      className="flex flex-wrap gap-1 rounded-xl border border-foreground/[0.07] bg-foreground/[0.02] p-1"
    >
      {MEMORY_TABS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={tab === id}
          onClick={() => onTabChange(id)}
          className={cn(
            "flex items-center gap-1.5 px-3 py-2 rounded-lg text-[0.78rem] font-medium transition-colors cursor-pointer",
            tab === id
              ? "bg-indigo-500/20 text-indigo-100"
              : "text-foreground/40 hover:text-foreground/65 hover:bg-foreground/[0.04]",
          )}
        >
          <Icon className="size-3.5 opacity-70" aria-hidden />
          {label}
        </button>
      ))}
    </div>
  );
}

function TagCloud({ label, items, accent }: { label: string; items: string[]; accent?: string }) {
  if (!items.length) return null;
  return (
    <div>
      <h4 className="text-[0.62rem] uppercase tracking-[0.18em] text-foreground/30 font-semibold mb-2">{label}</h4>
      <div className="flex flex-wrap gap-1.5">
        {items.map(item => (
          <span
            key={item}
            className={cn(
              "rounded-md border px-2 py-1 text-[0.72rem] text-foreground/55",
              accent ?? "border-foreground/10 bg-foreground/[0.04]",
            )}
          >
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

function LayerCard({
  id,
  name,
  detail,
  active,
  expanded,
  onToggle,
  children,
}: {
  id: LayerId;
  name: string;
  detail: string;
  active: boolean;
  expanded: boolean;
  onToggle: (id: LayerId) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn(
      "rounded-xl border transition-colors overflow-hidden",
      active ? "border-indigo-500/25 bg-indigo-500/[0.04]" : "border-foreground/[0.06] bg-foreground/[0.02]",
    )}>
      <button
        type="button"
        onClick={() => onToggle(id)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left cursor-pointer hover:bg-foreground/[0.03] transition-colors"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <span className={cn("size-2 rounded-full shrink-0", active ? "bg-indigo-400" : "bg-foreground/15")} />
          <span className={cn("text-sm font-medium", active ? "text-foreground/80" : "text-foreground/40")}>{name}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={cn(
            "text-[0.68rem] font-mono",
            active ? "text-indigo-300/80" : "text-foreground/20",
          )}>
            {detail}
          </span>
          <ChevronDown className={cn(
            "size-4 text-foreground/30 transition-transform",
            expanded && "rotate-180",
          )} />
        </div>
      </button>
      {expanded && children && (
        <div className="border-t border-foreground/[0.06] px-4 py-3 bg-foreground/[0.05]">
          {children}
        </div>
      )}
    </div>
  );
}

// ─── MemoryDashboard ──────────────────────────────────────────────────────────

export function MemoryDashboard({
  workspaceName,
  workspaceFacts,
  sessionSummaries,
  liveSessionSummary,
  liveFacts,
  memoryLoading,
  memoryStats,
  isActiveWorkspace,
  messageCount,
  summarizedCount,
  onFactPatch,
  onFactDelete,
}: {
  workspaceName: string;
  workspaceFacts: MemoryFactRecord[];
  sessionSummaries: MemorySummaryRecord[];
  liveSessionSummary: string;
  liveFacts: Record<string, string>;
  memoryLoading: boolean;
  memoryStats: MemoryStats | null;
  isActiveWorkspace: boolean;
  messageCount: number;
  summarizedCount: number;
  onFactPatch?: (factId: string, patch: { value?: string; pinned?: boolean; forgotten?: boolean }) => void;
  onFactDelete?: (factId: string) => void;
}) {
  const [summaryPeriod, setSummaryPeriod] = useState<SummaryPeriod>("day");
  const [expandedLayer, setExpandedLayer] = useState<LayerId | null>("facts");
  const [memoryTab, setMemoryTab] = useState<MemoryTab>("overview");
  const [selectedFactId, setSelectedFactId] = useState<string | null>(null);

  const allFacts = useMemo(
    () => mergeLiveFacts(workspaceFacts, isActiveWorkspace ? liveFacts : {}),
    [workspaceFacts, liveFacts, isActiveWorkspace],
  );

  const identityFacts = useMemo(
    () => allFacts.filter(f => IDENTITY_KEYS.has(f.key.toLowerCase())),
    [allFacts],
  );

  const visibleFacts = useMemo(
    () => allFacts.filter(f => formatFactValue(f.value) !== "—" && !f.forgotten),
    [allFacts],
  );

  const allSummaries = useMemo(() => {
    const list = [...sessionSummaries];
    if (isActiveWorkspace && liveSessionSummary.trim()) {
      const already = list.some(s => s.summary === liveSessionSummary);
      if (!already) {
        list.unshift({
          id: "live-session",
          summary: liveSessionSummary,
          turnsCovered: summarizedCount,
          updatedAt: new Date().toISOString(),
          session: { id: "live", createdAt: new Date().toISOString() },
        });
      }
    }
    return list;
  }, [sessionSummaries, isActiveWorkspace, liveSessionSummary, summarizedCount]);

  const groupedSummaries = useMemo(
    () => groupSummaries(allSummaries, summaryPeriod),
    [allSummaries, summaryPeriod],
  );


  const factAssociations = useMemo(
    () => buildFactAssociations(allFacts, allSummaries),
    [allFacts, allSummaries],
  );

  const selectedAssociation = useMemo(
    () => factAssociations.find(a => a.factId === selectedFactId) ?? null,
    [factAssociations, selectedFactId],
  );

  const selectFact = (fact: MemoryFactRecord) => {
    setSelectedFactId(fact.id);
    setMemoryTab("facts");
  };

  useEffect(() => {
    if (memoryTab === "facts" && !selectedFactId && factAssociations[0]) {
      setSelectedFactId(factAssociations[0].factId);
    }
  }, [memoryTab, selectedFactId, factAssociations]);

  const rawTurns = isActiveWorkspace
    ? Math.max(0, messageCount - summarizedCount)
    : 0;

  const toggleLayer = (id: LayerId) => {
    setExpandedLayer(prev => (prev === id ? null : id));
  };

  const isEmpty = !memoryLoading
    && visibleFacts.length === 0
    && allSummaries.length === 0;

  return (
    <div className="flex flex-col gap-6">
      {/* Guidance */}
      <div className="rounded-xl border border-foreground/[0.06] bg-foreground/[0.02] px-4 py-3.5 space-y-2">
        <p className="text-sm text-foreground/50 leading-relaxed">
          What{" "}
          <span className="text-foreground/75 font-medium">{workspaceName}</span>
          {" "}has retained from investigations — facts and rolling summaries grounded in this
          workspace&apos;s knowledge. This memory is isolated to this workspace and is available
          only to you and to Admins or the Super Admin of this account.
        </p>
        <p className="text-[0.72rem] text-foreground/32 leading-relaxed">
          Chat to grow this memory. Summaries compress past threads; extracted facts persist
          across sessions for this workspace.
        </p>
      </div>

      {memoryLoading && (
        <div className="flex items-center gap-2 text-sm text-foreground/35">
          <Loader2 className="size-4 animate-spin shrink-0" aria-hidden />
          Syncing memory…
        </div>
      )}

      {/* At-a-glance stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <StatCard label="Known facts" value={visibleFacts.length} hint="Identity + style" accent="violet" />
        <StatCard label="Summaries" value={allSummaries.length} hint={`Grouped by ${summaryPeriod}`} accent="indigo" />
        <StatCard
          label="Working turns"
          value={isActiveWorkspace ? rawTurns : "—"}
          hint={isActiveWorkspace ? "Uncompressed in thread" : "Open Chat"}
          accent="emerald"
        />
        <StatCard
          label="Semantic chunks"
          value={memoryStats?.semanticFragmentCount ?? "—"}
          hint="Vector-indexed memory"
          accent="amber"
        />
      </div>

      {!isEmpty && (
        <>
          <MemoryTabBar tab={memoryTab} onTabChange={setMemoryTab} />

          {memoryTab === "overview" && (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <section>
                  <div className="flex items-center gap-2 mb-3">
                    <User className="size-4 text-violet-400/70" aria-hidden />
                    <h3 className="text-[0.65rem] uppercase tracking-[0.22em] text-foreground/35 font-semibold">
                      Who you are
                    </h3>
                  </div>
                  <div className="rounded-2xl border border-foreground/[0.07] bg-foreground/[0.03] divide-y divide-foreground/[0.05] overflow-hidden min-h-[8rem]">
                    {identityFacts.filter(f => formatFactValue(f.value) !== "—").length === 0 ? (
                      <p className="px-4 py-6 text-sm text-foreground/30 text-center">No identity facts yet.</p>
                    ) : (
                      identityFacts.map(f => (
                        <FactRow
                          key={f.id}
                          fact={f}
                          live={f.id.startsWith("live-")}
                          selected={selectedFactId === f.id}
                          onSelect={selectFact}
                        />
                      ))
                    )}
                  </div>
                </section>

              </div>

              <section>
                <div className="flex items-center gap-2 mb-3">
                  <Layers className="size-4 text-foreground/40" aria-hidden />
                  <h3 className="text-[0.65rem] uppercase tracking-[0.22em] text-foreground/35 font-semibold">
                    Memory layers
                  </h3>
                  <span className="text-[0.62rem] text-foreground/25">Click a layer or fact to inspect</span>
                </div>
                <div className="flex flex-col gap-2">
                  <LayerCard
                    id="working"
                    name="Working memory"
                    detail={isActiveWorkspace ? `${rawTurns} raw turns` : "Open Chat"}
                    active={isActiveWorkspace && rawTurns > 0}
                    expanded={expandedLayer === "working"}
                    onToggle={toggleLayer}
                  >
                    <p className="text-[0.78rem] text-foreground/45 leading-relaxed">
                      The most recent messages kept in full before compression. When the conversation grows,
                      older turns roll into the session summary below.
                    </p>
                    {isActiveWorkspace && (
                      <p className="text-[0.72rem] text-indigo-300/70 mt-2">
                        {rawTurns} turn{rawTurns === 1 ? "" : "s"} currently uncompressed · {messageCount} total in thread
                      </p>
                    )}
                  </LayerCard>

                  <LayerCard
                    id="summary"
                    name="Session summary"
                    detail={allSummaries.length > 0 ? `${allSummaries.length} archived` : "—"}
                    active={allSummaries.length > 0}
                    expanded={expandedLayer === "summary"}
                    onToggle={toggleLayer}
                  >
                    <p className="text-[0.78rem] text-foreground/45 leading-relaxed mb-2">
                      Rolling narrative compression of your conversations — updated in the background every few turns.
                    </p>
                    {liveSessionSummary && isActiveWorkspace && (
                      <p className="text-sm text-foreground/55 leading-relaxed border-l-2 border-indigo-400/40 pl-3">
                        {liveSessionSummary}
                      </p>
                    )}
                  </LayerCard>

                  <LayerCard
                    id="facts"
                    name="Extracted facts"
                    detail={`${visibleFacts.length} known`}
                    active={visibleFacts.length > 0}
                    expanded={expandedLayer === "facts"}
                    onToggle={toggleLayer}
                  >
                    <p className="text-[0.78rem] text-foreground/45 leading-relaxed mb-3">
                      Structured knowledge pulled from conversations — click any fact to see how it links to summaries.
                    </p>
                    <div className="rounded-xl border border-foreground/[0.06] divide-y divide-foreground/[0.05] max-h-64 overflow-y-auto">
                      {visibleFacts.map(f => (
                        <FactRow
                          key={f.id}
                          fact={f}
                          live={f.id.startsWith("live-")}
                          selected={selectedFactId === f.id}
                          onSelect={selectFact}
                        />
                      ))}
                    </div>
                  </LayerCard>

                  <LayerCard
                    id="semantic"
                    name="Semantic index"
                    detail={
                      memoryStats && memoryStats.semanticFragmentCount + memoryStats.documentFragmentCount > 0
                        ? `${memoryStats.semanticFragmentCount + memoryStats.documentFragmentCount} chunks`
                        : "Empty"
                    }
                    active={!!memoryStats && memoryStats.semanticFragmentCount + memoryStats.documentFragmentCount > 0}
                    expanded={expandedLayer === "semantic"}
                    onToggle={toggleLayer}
                  >
                    <p className="text-[0.78rem] text-foreground/45 leading-relaxed">
                      Vector embeddings of past exchanges and uploaded documents. Retrieved automatically during chat
                      when your question matches stored content.
                    </p>
                    {memoryStats && (
                      <div className="mt-2 flex flex-wrap gap-2 text-[0.68rem]">
                        <span className="rounded-md border border-foreground/10 bg-foreground/[0.04] px-2 py-1 text-foreground/45">
                          Conversation: {memoryStats.semanticFragmentCount} chunks
                        </span>
                        <span className="rounded-md border border-foreground/10 bg-foreground/[0.04] px-2 py-1 text-foreground/45">
                          Documents: {memoryStats.documentFragmentCount} chunks
                        </span>
                      </div>
                    )}
                  </LayerCard>

                  <LayerCard
                    id="episodic"
                    name="Episodic archive"
                    detail={allSummaries.length > 0 ? `${allSummaries.length} summaries` : "Empty"}
                    active={allSummaries.length > 0}
                    expanded={expandedLayer === "episodic"}
                    onToggle={toggleLayer}
                  >
                    <p className="text-[0.78rem] text-foreground/45 leading-relaxed">
                      Older conversations live here as session summaries — the chronological archive
                      for this workspace. Open the Archive tab to read them by day.
                    </p>
                  </LayerCard>
                </div>
              </section>
            </>
          )}

          {memoryTab === "facts" && (
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
              <div className="lg:col-span-2 flex flex-col gap-2 max-h-[32rem] overflow-y-auto pr-1">
                <p className="text-[0.68rem] text-foreground/30 mb-1">
                  {factAssociations.length} facts · select to inspect associations
                </p>
                {factAssociations.map(assoc => (
                  <FactCard
                    key={assoc.factId}
                    assoc={assoc}
                    selected={selectedFactId === assoc.factId}
                    onSelect={() => setSelectedFactId(assoc.factId)}
                  />
                ))}
              </div>
              <div className="lg:col-span-3 lg:sticky lg:top-4 lg:self-start">
                {selectedAssociation ? (
                  <FactDetailPanel
                    assoc={selectedAssociation}
                    fact={visibleFacts.find(f => f.id === selectedAssociation.factId)}
                    onPatch={onFactPatch}
                    onDelete={onFactDelete}
                  />
                ) : (
                  <div className="rounded-2xl border border-dashed border-foreground/10 px-5 py-16 text-center">
                    <Layers className="size-8 text-foreground/15 mx-auto mb-3" aria-hidden />
                    <p className="text-sm text-foreground/40">Select a fact to see conversation links and related traits.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {memoryTab === "archive" && allSummaries.length > 0 && (
            <section>
              <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <MessageSquare className="size-4 text-indigo-400/70" aria-hidden />
                  <h3 className="text-[0.65rem] uppercase tracking-[0.22em] text-foreground/35 font-semibold">
                    Conversation archive
                  </h3>
                </div>
                <div className="flex rounded-lg border border-foreground/8 bg-foreground/[0.03] p-0.5">
                  {(["day", "month", "year"] as const).map(p => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setSummaryPeriod(p)}
                      className={cn(
                        "px-2.5 py-1 text-[0.68rem] font-medium rounded-md capitalize transition-colors cursor-pointer",
                        summaryPeriod === p
                          ? "bg-indigo-500/20 text-indigo-200"
                          : "text-foreground/35 hover:text-foreground/55",
                      )}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-4">
                {groupedSummaries.map(group => (
                  <div key={group.key}>
                    <h4 className="sticky top-0 z-[1] -mx-1 mb-2 px-1 py-1 text-[0.65rem] uppercase tracking-[0.2em] text-foreground/28 font-semibold backdrop-blur-sm bg-card/85">
                      {group.label}
                      <span className="ml-2 normal-case tracking-normal text-foreground/20 font-normal">
                        · {group.items.length} {group.items.length === 1 ? "session" : "sessions"}
                      </span>
                    </h4>
                    <div className="flex flex-col gap-2.5 pl-3 border-l-2 border-indigo-500/20">
                      {group.items.map(s => {
                        const isLive = s.id === "live-session";
                        return (
                          <div
                            key={s.id}
                            className={cn(
                              "rounded-xl border px-4 py-3.5",
                              isLive
                                ? "bg-indigo-500/[0.06] border-indigo-400/20"
                                : "bg-foreground/[0.025] border-foreground/[0.06]",
                            )}
                          >
                            <div className="flex items-center justify-between gap-2 mb-2">
                              <span className={cn(
                                "text-[0.62rem] uppercase tracking-wider font-semibold",
                                isLive ? "text-indigo-400/70" : "text-foreground/28",
                              )}>
                                {isLive ? "Current session" : `${s.turnsCovered} turns`}
                              </span>
                              {!isLive && (
                                <span className="text-[0.6rem] text-foreground/22 tabular-nums">
                                  {new Date(s.session.createdAt).toLocaleTimeString(undefined, {
                                    hour: "numeric",
                                    minute: "2-digit",
                                  })}
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-foreground/60 leading-relaxed">{s.summary}</p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {memoryTab === "archive" && allSummaries.length === 0 && (
            <div className="rounded-2xl border border-dashed border-foreground/10 px-5 py-12 text-center">
              <MessageSquare className="size-8 text-foreground/15 mx-auto mb-3" aria-hidden />
              <p className="text-sm text-foreground/40">No archived summaries yet — keep chatting to build the archive.</p>
            </div>
          )}
        </>
      )}

      {isEmpty && (
        <div className="rounded-2xl border border-dashed border-foreground/10 px-5 py-12 text-center space-y-3">
          <Brain className="size-10 text-violet-400/25 mx-auto" aria-hidden />
          <p className="text-sm font-medium text-foreground/50">No memory built yet</p>
          <p className="text-xs text-foreground/30 leading-relaxed max-w-sm mx-auto">
            Start an investigation in {workspaceName}. Facts and summaries will appear here
            automatically as you work.
          </p>
        </div>
      )}
    </div>
  );
}
