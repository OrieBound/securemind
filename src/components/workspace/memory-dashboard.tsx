"use client";

import {
  Brain,
  ChevronDown,
  Heart,
  Layers,
  Loader2,
  MessageSquare,
  User,
} from "lucide-react";
import { useMemo, useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { formatFactValue, humanizeKey } from "@/lib/memory/format";
import { buildPersonalityProfile } from "@/lib/memory/personality";
import { buildFactAssociations, categoryLabel as factCategoryLabel, type FactAssociation } from "@/lib/memory/fact-graph";
import { PersonalityRadar, TraitBar } from "@/components/workspace/personality-radar";

// ─── types ────────────────────────────────────────────────────────────────────

export type MemoryFactRecord = {
  id: string;
  key: string;
  value: string;
  confidence: number;
  source: string | null;
  updatedAt: string;
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

const BEHAVIORAL_KEYS = new Set([
  "response_length",
  "technical_level",
  "communication_style",
  "preferred_topics",
  "tone_preference",
  "feedback_style",
]);

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

const TEMPERAMENT_KEYS = new Set([
  "tone_preference",
  "feedback_style",
  "communication_style",
  "response_length",
  "sociability",
  "talkativeness",
  "patience",
  "calmness",
  "sensitivity",
  "politeness",
  "emotional_tone",
  "preferred_problem_types",
]);

type MemoryTab = "overview" | "personality" | "facts" | "archive";

const MEMORY_TABS: { id: MemoryTab; label: string; icon: typeof Brain }[] = [
  { id: "overview", label: "Overview", icon: Brain },
  { id: "personality", label: "Personality", icon: Heart },
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
  agentFacts: MemoryFactRecord[],
  userFacts: MemoryFactRecord[],
  liveFacts: Record<string, string>,
): MemoryFactRecord[] {
  const byKey = new Map<string, MemoryFactRecord>();
  for (const f of userFacts) byKey.set(f.key.toLowerCase(), { ...f, key: f.key });
  for (const f of agentFacts) byKey.set(f.key.toLowerCase(), f);
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
      <p className="text-[0.62rem] uppercase tracking-[0.18em] text-white/35 font-semibold">{label}</p>
      <p className="text-xl font-bold text-white/90 tabular-nums mt-1">{value}</p>
      {hint && <p className="text-[0.65rem] text-white/30 mt-0.5">{hint}</p>}
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
        interactive && "cursor-pointer hover:bg-white/[0.04]",
        selected && "bg-indigo-500/[0.08]",
      )}
    >
      <span className={cn(
        "mt-1.5 size-1.5 rounded-full shrink-0",
        live ? "bg-indigo-400 animate-pulse" : confidenceColor(fact.confidence),
      )} />
      <div className="flex-1 min-w-0">
        <p className="text-[0.68rem] text-white/35 capitalize">{humanizeKey(fact.key)}</p>
        <p className="text-sm text-white/82 font-medium leading-snug mt-0.5 break-words">{display}</p>
      </div>
      <div className="text-right shrink-0">
        {live ? (
          <span className="text-[0.58rem] uppercase tracking-wider text-indigo-400/80 font-bold">Live</span>
        ) : (
          <span className="text-[0.6rem] text-white/25 tabular-nums">{Math.round(fact.confidence * 100)}%</span>
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
          : "border-white/[0.07] bg-white/[0.025] hover:border-white/12 hover:bg-white/[0.04]",
      )}
    >
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="text-[0.62rem] uppercase tracking-wider text-white/35 font-semibold">
          {humanizeKey(assoc.key)}
        </span>
        <span className={cn(
          "text-[0.58rem] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded",
          assoc.category === "personality" && "text-violet-300/80 bg-violet-500/10",
          assoc.category === "behavioral" && "text-rose-300/70 bg-rose-500/10",
          assoc.category === "identity" && "text-emerald-300/70 bg-emerald-500/10",
          assoc.category === "other" && "text-white/30 bg-white/[0.06]",
        )}>
          {factCategoryLabel(assoc.category)}
        </span>
      </div>
      <p className="text-sm text-white/75 font-medium leading-snug line-clamp-2">{assoc.value}</p>
      <p className="text-[0.62rem] text-white/25 mt-2">
        {assoc.relatedSummaries.length} linked · {assoc.relatedFacts.length} related
      </p>
    </button>
  );
}

function FactDetailPanel({ assoc }: { assoc: FactAssociation }) {
  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] overflow-hidden">
      <div className="px-4 py-4 border-b border-white/[0.06] bg-indigo-500/[0.04]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[0.65rem] uppercase tracking-wider text-white/35 font-semibold">
              {humanizeKey(assoc.key)}
            </p>
            <p className="text-lg font-semibold text-white/90 mt-1 leading-snug">{assoc.value}</p>
          </div>
          <span className={cn(
            "text-[0.58rem] uppercase tracking-wider font-bold px-2 py-1 rounded-md shrink-0",
            assoc.live ? "text-indigo-300 bg-indigo-500/15" : "text-white/35 bg-white/[0.06]",
          )}>
            {assoc.live ? "Live" : `${Math.round(assoc.confidence * 100)}%`}
          </span>
        </div>
        <p className="text-[0.68rem] text-white/30 mt-2">
          {factCategoryLabel(assoc.category)} · Updated {new Date(assoc.updatedAt).toLocaleDateString(undefined, {
            month: "short", day: "numeric", year: "numeric",
          })}
        </p>
      </div>

      <div className="px-4 py-4 space-y-5">
        <section>
          <h4 className="text-[0.62rem] uppercase tracking-[0.18em] text-white/30 font-semibold mb-2.5">
            Conversation links
          </h4>
          {assoc.relatedSummaries.length === 0 ? (
            <p className="text-sm text-white/30 italic">
              No direct summary match yet — this fact may come from live extraction or broader context.
            </p>
          ) : (
            <div className="flex flex-col gap-2.5">
              {assoc.relatedSummaries.map(s => (
                <div key={s.id} className="rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="text-[0.6rem] text-white/28 uppercase tracking-wider">
                      {s.id === "live-session" ? "Current session" : `${s.turnsCovered} turns`}
                    </span>
                    <span className="text-[0.6rem] text-white/22 tabular-nums">
                      {new Date(s.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </span>
                  </div>
                  <p className="text-[0.78rem] text-white/50 leading-relaxed">{s.excerpt}</p>
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <h4 className="text-[0.62rem] uppercase tracking-[0.18em] text-white/30 font-semibold mb-2.5">
            Related facts
          </h4>
          {assoc.relatedFacts.length === 0 ? (
            <p className="text-sm text-white/30 italic">No closely related facts yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {assoc.relatedFacts.map(rf => (
                <div key={rf.key} className="flex items-start gap-2 rounded-lg border border-white/[0.05] px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-[0.65rem] text-white/35 capitalize">{humanizeKey(rf.key)}</p>
                    <p className="text-sm text-white/65 mt-0.5">{rf.value}</p>
                  </div>
                  <span className="text-[0.58rem] text-white/22 shrink-0 max-w-[5rem] text-right leading-tight">
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
      className="flex flex-wrap gap-1 rounded-xl border border-white/[0.07] bg-white/[0.02] p-1"
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
              : "text-white/40 hover:text-white/65 hover:bg-white/[0.04]",
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
      <h4 className="text-[0.62rem] uppercase tracking-[0.18em] text-white/30 font-semibold mb-2">{label}</h4>
      <div className="flex flex-wrap gap-1.5">
        {items.map(item => (
          <span
            key={item}
            className={cn(
              "rounded-md border px-2 py-1 text-[0.72rem] text-white/55",
              accent ?? "border-white/10 bg-white/[0.04]",
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
      active ? "border-indigo-500/25 bg-indigo-500/[0.04]" : "border-white/[0.06] bg-white/[0.02]",
    )}>
      <button
        type="button"
        onClick={() => onToggle(id)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left cursor-pointer hover:bg-white/[0.03] transition-colors"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <span className={cn("size-2 rounded-full shrink-0", active ? "bg-indigo-400" : "bg-white/15")} />
          <span className={cn("text-sm font-medium", active ? "text-white/80" : "text-white/40")}>{name}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={cn(
            "text-[0.68rem] font-mono",
            active ? "text-indigo-300/80" : "text-white/20",
          )}>
            {detail}
          </span>
          <ChevronDown className={cn(
            "size-4 text-white/30 transition-transform",
            expanded && "rotate-180",
          )} />
        </div>
      </button>
      {expanded && children && (
        <div className="border-t border-white/[0.06] px-4 py-3 bg-black/20">
          {children}
        </div>
      )}
    </div>
  );
}

// ─── MemoryDashboard ──────────────────────────────────────────────────────────

export function MemoryDashboard({
  companionName,
  agentFacts,
  userFacts,
  sessionSummaries,
  liveSessionSummary,
  liveFacts,
  memoryLoading,
  memoryStats,
  isActiveCompanion,
  messageCount,
  summarizedCount,
}: {
  companionName: string;
  agentFacts: MemoryFactRecord[];
  userFacts: MemoryFactRecord[];
  sessionSummaries: MemorySummaryRecord[];
  liveSessionSummary: string;
  liveFacts: Record<string, string>;
  memoryLoading: boolean;
  memoryStats: MemoryStats | null;
  isActiveCompanion: boolean;
  messageCount: number;
  summarizedCount: number;
}) {
  const [summaryPeriod, setSummaryPeriod] = useState<SummaryPeriod>("day");
  const [expandedLayer, setExpandedLayer] = useState<LayerId | null>("facts");
  const [memoryTab, setMemoryTab] = useState<MemoryTab>("overview");
  const [selectedFactId, setSelectedFactId] = useState<string | null>(null);

  const allFacts = useMemo(
    () => mergeLiveFacts(agentFacts, userFacts, isActiveCompanion ? liveFacts : {}),
    [agentFacts, userFacts, liveFacts, isActiveCompanion],
  );

  const identityFacts = useMemo(
    () => allFacts.filter(f => IDENTITY_KEYS.has(f.key.toLowerCase()) || (!BEHAVIORAL_KEYS.has(f.key.toLowerCase()) && !TEMPERAMENT_KEYS.has(f.key.toLowerCase()) && !["identity", "behavioral", "identity_confirmed"].includes(f.key.toLowerCase()))),
    [allFacts],
  );

  const visibleFacts = useMemo(
    () => allFacts.filter(f => formatFactValue(f.value) !== "—"),
    [allFacts],
  );

  const allSummaries = useMemo(() => {
    const list = [...sessionSummaries];
    if (isActiveCompanion && liveSessionSummary.trim()) {
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
  }, [sessionSummaries, isActiveCompanion, liveSessionSummary, summarizedCount]);

  const groupedSummaries = useMemo(
    () => groupSummaries(allSummaries, summaryPeriod),
    [allSummaries, summaryPeriod],
  );

  const personality = useMemo(
    () => buildPersonalityProfile(allFacts, allSummaries),
    [allFacts, allSummaries],
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

  const rawTurns = isActiveCompanion
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
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3.5 space-y-2">
        <p className="text-sm text-white/50 leading-relaxed">
          A living profile of what{" "}
          <span className="text-white/75 font-medium">{companionName}</span> has learned from your
          conversations — facts, communication style, and rolling summaries. Everything here is
          inferred automatically; nothing is shared outside your workspace.
        </p>
        <p className="text-[0.72rem] text-white/32 leading-relaxed">
          Chat to refine this profile. Summaries compress past conversations; extracted facts persist
          across sessions for this companion.
        </p>
      </div>

      {memoryLoading && (
        <div className="flex items-center gap-2 text-sm text-white/35">
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
          value={isActiveCompanion ? rawTurns : "—"}
          hint={isActiveCompanion ? "Uncompressed in chat" : "Open Chat"}
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
                    <h3 className="text-[0.65rem] uppercase tracking-[0.22em] text-white/35 font-semibold">
                      Who you are
                    </h3>
                  </div>
                  <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] divide-y divide-white/[0.05] overflow-hidden min-h-[8rem]">
                    {identityFacts.filter(f => formatFactValue(f.value) !== "—").length === 0 ? (
                      <p className="px-4 py-6 text-sm text-white/30 text-center">No identity facts yet.</p>
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

                <section>
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2">
                      <Heart className="size-4 text-rose-400/60" aria-hidden />
                      <h3 className="text-[0.65rem] uppercase tracking-[0.22em] text-white/35 font-semibold">
                        Personality snapshot
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={() => setMemoryTab("personality")}
                      className="text-[0.68rem] text-indigo-300/70 hover:text-indigo-200 transition-colors cursor-pointer"
                    >
                      Full chart →
                    </button>
                  </div>
                  <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] overflow-hidden">
                    <div className="px-4 py-3.5 border-b border-white/[0.05] bg-rose-500/[0.04]">
                      <p className="text-sm text-white/60 leading-relaxed italic">{personality.narrative}</p>
                    </div>
                    <div className="p-4">
                      <PersonalityRadar axes={personality.radar.slice(0, 6)} />
                    </div>
                  </div>
                </section>
              </div>

              <section>
                <div className="flex items-center gap-2 mb-3">
                  <Layers className="size-4 text-white/40" aria-hidden />
                  <h3 className="text-[0.65rem] uppercase tracking-[0.22em] text-white/35 font-semibold">
                    Memory layers
                  </h3>
                  <span className="text-[0.62rem] text-white/25">Click a layer or fact to inspect</span>
                </div>
                <div className="flex flex-col gap-2">
                  <LayerCard
                    id="working"
                    name="Working memory"
                    detail={isActiveCompanion ? `${rawTurns} raw turns` : "Open Chat"}
                    active={isActiveCompanion && rawTurns > 0}
                    expanded={expandedLayer === "working"}
                    onToggle={toggleLayer}
                  >
                    <p className="text-[0.78rem] text-white/45 leading-relaxed">
                      The most recent messages kept in full before compression. When the conversation grows,
                      older turns roll into the session summary below.
                    </p>
                    {isActiveCompanion && (
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
                    <p className="text-[0.78rem] text-white/45 leading-relaxed mb-2">
                      Rolling narrative compression of your conversations — updated in the background every few turns.
                    </p>
                    {liveSessionSummary && isActiveCompanion && (
                      <p className="text-sm text-white/55 leading-relaxed border-l-2 border-indigo-400/40 pl-3">
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
                    <p className="text-[0.78rem] text-white/45 leading-relaxed mb-3">
                      Structured knowledge pulled from conversations — click any fact to see how it links to summaries.
                    </p>
                    <div className="rounded-xl border border-white/[0.06] divide-y divide-white/[0.05] max-h-64 overflow-y-auto">
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
                    <p className="text-[0.78rem] text-white/45 leading-relaxed">
                      Vector embeddings of past exchanges and uploaded documents. Retrieved automatically during chat
                      when your question matches stored content.
                    </p>
                    {memoryStats && (
                      <div className="mt-2 flex flex-wrap gap-2 text-[0.68rem]">
                        <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-white/45">
                          Conversation: {memoryStats.semanticFragmentCount} chunks
                        </span>
                        <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-white/45">
                          Documents: {memoryStats.documentFragmentCount} chunks
                        </span>
                      </div>
                    )}
                  </LayerCard>

                  <LayerCard
                    id="episodic"
                    name="Episodic archive"
                    detail="Phase B"
                    active={false}
                    expanded={expandedLayer === "episodic"}
                    onToggle={toggleLayer}
                  >
                    <p className="text-[0.78rem] text-white/45 leading-relaxed">
                      Long-term chronological memory of significant moments across months and years.
                      Planned for a future phase — session summaries above are the current foundation.
                    </p>
                  </LayerCard>
                </div>
              </section>
            </>
          )}

          {memoryTab === "personality" && (
            <div className="flex flex-col gap-6">
              <div className="rounded-xl border border-white/[0.06] bg-violet-500/[0.04] px-4 py-3.5">
                <p className="text-sm text-white/55 leading-relaxed italic">{personality.narrative}</p>
                <p className="text-[0.68rem] text-white/28 mt-2">
                  Inferred from extracted facts and conversation summaries — not a clinical assessment.
                </p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <section className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5">
                  <h3 className="text-[0.65rem] uppercase tracking-[0.22em] text-white/35 font-semibold mb-4">
                    Personality flow
                  </h3>
                  <PersonalityRadar axes={personality.radar} />
                </section>

                <section className="space-y-4">
                  <h3 className="text-[0.65rem] uppercase tracking-[0.22em] text-white/35 font-semibold">
                    Trait breakdown
                  </h3>
                  {(["social", "emotional", "communication", "cognitive"] as const).map(cat => {
                    const group = personality.traits.filter(t => t.category === cat);
                    if (!group.length) return null;
                    return (
                      <div key={cat}>
                        <p className="text-[0.6rem] uppercase tracking-wider text-white/25 mb-2 capitalize">{cat}</p>
                        <div className="flex flex-col gap-2">
                          {group.map(t => (
                            <TraitBar
                              key={t.id}
                              label={t.label}
                              score={t.score}
                              level={t.level}
                              evidence={t.evidence}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </section>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5">
                <TagCloud
                  label="Topics they discuss"
                  items={personality.topics}
                  accent="border-violet-500/15 bg-violet-500/[0.06]"
                />
                <TagCloud
                  label="Problem domains"
                  items={personality.problemDomains}
                  accent="border-indigo-500/15 bg-indigo-500/[0.06]"
                />
                <TagCloud
                  label="Emotional tone"
                  items={personality.emotionalTags}
                  accent="border-rose-500/15 bg-rose-500/[0.06]"
                />
              </div>
            </div>
          )}

          {memoryTab === "facts" && (
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
              <div className="lg:col-span-2 flex flex-col gap-2 max-h-[32rem] overflow-y-auto pr-1">
                <p className="text-[0.68rem] text-white/30 mb-1">
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
                  <FactDetailPanel assoc={selectedAssociation} />
                ) : (
                  <div className="rounded-2xl border border-dashed border-white/10 px-5 py-16 text-center">
                    <Layers className="size-8 text-white/15 mx-auto mb-3" aria-hidden />
                    <p className="text-sm text-white/40">Select a fact to see conversation links and related traits.</p>
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
                  <h3 className="text-[0.65rem] uppercase tracking-[0.22em] text-white/35 font-semibold">
                    Conversation archive
                  </h3>
                </div>
                <div className="flex rounded-lg border border-white/8 bg-white/[0.03] p-0.5">
                  {(["day", "month", "year"] as const).map(p => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setSummaryPeriod(p)}
                      className={cn(
                        "px-2.5 py-1 text-[0.68rem] font-medium rounded-md capitalize transition-colors cursor-pointer",
                        summaryPeriod === p
                          ? "bg-indigo-500/20 text-indigo-200"
                          : "text-white/35 hover:text-white/55",
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
                    <h4 className="sticky top-0 z-[1] -mx-1 mb-2 px-1 py-1 text-[0.65rem] uppercase tracking-[0.2em] text-white/28 font-semibold backdrop-blur-sm bg-[#0d0d11]/85">
                      {group.label}
                      <span className="ml-2 normal-case tracking-normal text-white/20 font-normal">
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
                                : "bg-white/[0.025] border-white/[0.06]",
                            )}
                          >
                            <div className="flex items-center justify-between gap-2 mb-2">
                              <span className={cn(
                                "text-[0.62rem] uppercase tracking-wider font-semibold",
                                isLive ? "text-indigo-400/70" : "text-white/28",
                              )}>
                                {isLive ? "Current session" : `${s.turnsCovered} turns`}
                              </span>
                              {!isLive && (
                                <span className="text-[0.6rem] text-white/22 tabular-nums">
                                  {new Date(s.session.createdAt).toLocaleTimeString(undefined, {
                                    hour: "numeric",
                                    minute: "2-digit",
                                  })}
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-white/60 leading-relaxed">{s.summary}</p>
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
            <div className="rounded-2xl border border-dashed border-white/10 px-5 py-12 text-center">
              <MessageSquare className="size-8 text-white/15 mx-auto mb-3" aria-hidden />
              <p className="text-sm text-white/40">No archived summaries yet — keep chatting to build the archive.</p>
            </div>
          )}
        </>
      )}

      {isEmpty && (
        <div className="rounded-2xl border border-dashed border-white/10 px-5 py-12 text-center space-y-3">
          <Brain className="size-10 text-violet-400/25 mx-auto" aria-hidden />
          <p className="text-sm font-medium text-white/50">No memory built yet</p>
          <p className="text-xs text-white/30 leading-relaxed max-w-sm mx-auto">
            Start a conversation with {companionName}. Facts, summaries, and communication insights
            will appear here automatically as you chat.
          </p>
        </div>
      )}
    </div>
  );
}
