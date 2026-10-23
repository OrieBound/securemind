"use client";

import { Brain, Download, Loader2, MessageSquare, User } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { formatFactValue, humanizeKey } from "@/lib/memory/format";
import { buildFactAssociations, categoryLabel as factCategoryLabel, type FactAssociation } from "@/lib/memory/fact-graph";
import { relativeTime } from "@/lib/models/key-health";
import type { MemoryOverview } from "@/lib/memory/overview-types";
import { EvidenceCard, KnowledgeLibrary, PrivacyCard, SectionHeading, useMemoryOverview } from "@/components/app/memory-overview";

export type MemoryFactRecord = {
  id: string;
  key: string;
  value: string;
  confidence: number;
  source: string | null;
  updatedAt: string;
  pinned?: boolean;
  forgotten?: boolean;
  /** Set when the user corrected, pinned or forgot this fact. */
  correctedAt?: string | null;
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

const PROFILE_KEYS = new Set(["name", "age", "occupation", "location", "job", "role"]);

const PROFILE_ORDER = ["name", "age", "role", "job", "occupation", "location"];

const WORK_KEYS = new Set(["project", "projects", "goals", "skills", "interests"]);

const PREFERENCE_KEYS = new Set([
  "preferred_response_length",
  "response_length",
  "technical_level",
]);

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

/**
 * Stored facts are the record of truth and carry the Correct, Pin and Forget controls. A fact the user
 * pinned or corrected always wins. Otherwise a live fact from this session replaces the stored one only
 * when its value is different (a new extraction that has not been saved yet). When the two agree, the
 * stored fact stays, so its controls stay too.
 */
export function mergeLiveFacts(
  workspaceFacts: MemoryFactRecord[],
  liveFacts: Record<string, string>,
): MemoryFactRecord[] {
  const byKey = new Map<string, MemoryFactRecord>();
  for (const f of workspaceFacts) byKey.set(f.key.toLowerCase(), f);
  for (const [k, v] of Object.entries(liveFacts)) {
    const liveValue = typeof v === "string" ? v : formatFactValue(v);
    const stored = byKey.get(k.toLowerCase());
    if (stored && (stored.pinned || stored.correctedAt || formatFactValue(stored.value) === liveValue)) continue;
    byKey.set(k.toLowerCase(), {
      id: `live-${k}`,
      key: k,
      value: liveValue,
      confidence: 0.75,
      source: null,
      updatedAt: new Date().toISOString(),
    });
  }
  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}

function OverviewTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 font-semibold tabular-nums text-foreground",
          typeof value === "number" ? "text-2xl" : "text-lg leading-8",
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
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
  const badge = live
    ? "New"
    : fact.pinned
      ? "Pinned"
      : fact.correctedAt
        ? "Edited"
        : null;
  const learned = live ? null : relativeTime(fact.updatedAt);
  return (
    <Wrapper
      type={interactive ? "button" : undefined}
      onClick={interactive ? () => onSelect!(fact) : undefined}
      aria-pressed={interactive ? !!selected : undefined}
      className={cn(
        "flex items-start gap-3 px-4 py-3 w-full text-left transition-colors",
        interactive && "cursor-pointer hover:bg-secondary",
        selected && "bg-[var(--primary-soft)] hover:bg-[var(--primary-soft)]",
      )}
    >
      <div className="flex-1 min-w-0">
        <p className="text-xs text-muted-foreground capitalize">{humanizeKey(fact.key)}</p>
        <p className="mt-0.5 text-sm font-medium leading-snug text-foreground break-words">{display}</p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1 text-right">
        {badge && (
          <span className="rounded-full border border-[var(--primary-border)] bg-[var(--primary-soft)] px-2 py-0.5 text-[0.7rem] font-medium text-[var(--primary-soft-foreground)]">
            {badge}
          </span>
        )}
        {learned && <span className="text-xs text-muted-foreground">Learned {learned}</span>}
      </div>
    </Wrapper>
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
            {assoc.live ? "Just captured" : `${Math.round(assoc.confidence * 100)}%`}
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
      {(assoc.relatedSummaries.length > 0 || assoc.relatedFacts.length > 0) && (
        <div className="px-4 py-3 space-y-3">
          {assoc.relatedSummaries.length > 0 && (
            <div>
              <p className="text-[0.62rem] uppercase tracking-wider text-foreground/30 font-semibold mb-1.5">
                Seen in conversation notes
              </p>
              <ul className="space-y-1.5">
                {assoc.relatedSummaries.slice(0, 4).map(s => (
                  <li key={s.id} className="text-[0.78rem] text-foreground/55 leading-relaxed">
                    {s.excerpt}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {assoc.relatedFacts.length > 0 && (
            <div>
              <p className="text-[0.62rem] uppercase tracking-wider text-foreground/30 font-semibold mb-1.5">
                Related
              </p>
              <ul className="space-y-1">
                {assoc.relatedFacts.map(r => (
                  <li key={r.key} className="text-[0.78rem] text-foreground/50">
                    <span className="capitalize">{humanizeKey(r.key)}</span>
                    {": "}
                    {r.value}
                    <span className="text-foreground/28"> · {r.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
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

function NoteCard({ summary, live, turns }: { summary: string; live: boolean; turns: number }) {
  const [open, setOpen] = useState(false);
  const long = summary.length > 220;
  return (
    <div className={cn("rounded-xl border px-4 py-3.5", live ? "border-[var(--primary-border)] bg-[var(--primary-soft)]" : "border-border bg-card")}>
      <p className="text-xs font-medium text-muted-foreground">
        {live ? "Current conversation" : `${turns} message${turns === 1 ? "" : "s"} summarised`}
      </p>
      <p className={cn("mt-1.5 text-sm leading-relaxed text-foreground", !open && long && "line-clamp-3")}>{summary}</p>
      {long && (
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          className="mt-1.5 text-xs font-medium text-muted-foreground underline underline-offset-4 hover:text-foreground cursor-pointer"
        >
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

export function MemoryDashboard({
  workspaceId,
  workspaceName,
  workspaceFacts,
  sessionSummaries,
  liveSessionSummary,
  liveFacts,
  memoryLoading,
  memoryStats,
  isActiveWorkspace,
  summarizedCount,
  onFactPatch,
  onFactDelete,
  onOpenKnowledge,
  overview: overviewOverride,
}: {
  workspaceId?: string | null;
  workspaceName: string;
  workspaceFacts: MemoryFactRecord[];
  sessionSummaries: MemorySummaryRecord[];
  liveSessionSummary: string;
  liveFacts: Record<string, string>;
  memoryLoading: boolean;
  memoryStats: MemoryStats | null;
  isActiveWorkspace: boolean;
  summarizedCount: number;
  onFactPatch?: (factId: string, patch: { value?: string; pinned?: boolean; forgotten?: boolean }) => void;
  onFactDelete?: (factId: string) => void;
  onOpenKnowledge?: () => void;
  /** Supplied by previews and tests. When set, nothing is fetched. */
  overview?: MemoryOverview | null;
}) {
  const [selectedFactId, setSelectedFactId] = useState<string | null>(null);
  const fetched = useMemoryOverview(workspaceId, overviewOverride !== undefined);
  const overview = overviewOverride !== undefined ? overviewOverride : fetched.data;
  const overviewLoading = overviewOverride !== undefined ? false : fetched.loading;

  const allFacts = useMemo(
    () => mergeLiveFacts(workspaceFacts, isActiveWorkspace ? liveFacts : {}),
    [workspaceFacts, liveFacts, isActiveWorkspace],
  );

  const visibleFacts = useMemo(
    () => allFacts.filter(f => formatFactValue(f.value) !== "—" && !f.forgotten),
    [allFacts],
  );

  const factGroups = useMemo(() => {
    const byKey = (f: MemoryFactRecord) => f.key.toLowerCase();
    return [
      {
        id: "you",
        title: "About you",
        facts: visibleFacts
          .filter(f => PROFILE_KEYS.has(byKey(f)))
          .sort((a, b) => PROFILE_ORDER.indexOf(byKey(a)) - PROFILE_ORDER.indexOf(byKey(b))),
      },
      { id: "work", title: "Work and interests", facts: visibleFacts.filter(f => WORK_KEYS.has(byKey(f))) },
      { id: "style", title: "How you like answers", facts: visibleFacts.filter(f => PREFERENCE_KEYS.has(byKey(f))) },
      {
        id: "other",
        title: "Other things you mentioned",
        facts: visibleFacts.filter(
          f => !PROFILE_KEYS.has(byKey(f)) && !WORK_KEYS.has(byKey(f)) && !PREFERENCE_KEYS.has(byKey(f)),
        ),
      },
    ].filter(g => g.facts.length > 0);
  }, [visibleFacts]);

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

  const groupedSummaries = useMemo(() => groupSummaries(allSummaries, "day"), [allSummaries]);

  const factAssociations = useMemo(
    () => buildFactAssociations(allFacts, allSummaries),
    [allFacts, allSummaries],
  );

  const selectedAssociation = useMemo(
    () => factAssociations.find(a => a.factId === selectedFactId) ?? null,
    [factAssociations, selectedFactId],
  );

  const documents = overview?.documents ?? [];
  const passages = overview
    ? documents.reduce((sum, d) => sum + d.chunkCount, 0)
    : (memoryStats?.documentFragmentCount ?? 0);
  const lastLearned = useMemo(() => {
    const stored = visibleFacts.filter(f => !f.id.startsWith("live-"));
    if (stored.length === 0) return null;
    const newest = stored.reduce((a, b) => (Date.parse(a.updatedAt) >= Date.parse(b.updatedAt) ? a : b));
    return relativeTime(newest.updatedAt);
  }, [visibleFacts]);

  function exportMemory() {
    const payload = {
      workspace: workspaceName,
      exportedAt: new Date().toISOString(),
      facts: visibleFacts
        .filter(f => !f.id.startsWith("live-"))
        .map(f => ({ key: f.key, value: formatFactValue(f.value), pinned: !!f.pinned, updatedAt: f.updatedAt })),
      conversationNotes: allSummaries
        .filter(s => s.id !== "live-session")
        .map(s => ({ date: s.session.createdAt, messages: s.turnsCovered, summary: s.summary })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const slug = workspaceName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "workspace";
    a.href = url;
    a.download = `${slug}-memory.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start justify-between gap-4">
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          What <span className="font-medium text-foreground">{workspaceName}</span> has kept from your conversations and
          files. Facts come only from what you say in chat. Assistant replies and guesses are never saved as facts about you.
        </p>
        <button
          type="button"
          onClick={exportMemory}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-foreground hover:bg-secondary cursor-pointer"
        >
          <Download className="size-3.5" aria-hidden />
          Export
        </button>
      </div>

      {memoryLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin shrink-0" aria-hidden />
          Reading what this workspace has stored…
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <OverviewTile label="Facts remembered" value={visibleFacts.length} hint="From things you said" />
        <OverviewTile
          label="Files in Knowledge"
          value={documents.length}
          hint={passages > 0 ? `${passages} searchable passages` : "Nothing uploaded yet"}
        />
        <OverviewTile label="Conversations kept" value={allSummaries.length} hint="Saved summaries" />
        <OverviewTile label="Last learned" value={lastLearned ?? "—"} hint="Most recent fact" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <EvidenceCard evidence={overview?.evidence ?? null} loading={overviewLoading} />
        <PrivacyCard privacy={overview?.privacy ?? null} loading={overviewLoading} />
      </div>

      <section>
        <SectionHeading
          icon={<User className="size-4" />}
          title={`What ${workspaceName} knows about you`}
          hint="Select a fact to pin it, correct it or forget it. Forgotten facts stay saved but are hidden from chat."
        />
        {factGroups.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border px-5 py-8 text-center">
            <Brain className="mx-auto size-7 text-muted-foreground" aria-hidden />
            <p className="mt-2 text-sm font-medium text-foreground">Nothing saved from chat yet</p>
            <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
              It keeps what you state about yourself, such as your role, what you are working on, or how you like
              replies. Try something like: “I’m a cloud engineer, and I’m migrating our logging to OpenSearch.”
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {factGroups.map(group => (
              <div key={group.id}>
                <h4 className="mb-1.5 px-1 text-xs font-medium text-muted-foreground">{group.title}</h4>
                <div className="overflow-hidden rounded-2xl border border-border bg-card divide-y divide-border">
                  {group.facts.map(f => (
                    <FactRow
                      key={f.id}
                      fact={f}
                      live={f.id.startsWith("live-")}
                      selected={selectedFactId === f.id}
                      onSelect={fact => setSelectedFactId(fact.id)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        {selectedAssociation && (
          <div className="mt-3">
            <FactDetailPanel
              assoc={selectedAssociation}
              fact={visibleFacts.find(f => f.id === selectedAssociation.factId)}
              onPatch={onFactPatch}
              onDelete={onFactDelete}
            />
          </div>
        )}
      </section>

      <KnowledgeLibrary documents={documents} loading={overviewLoading} onOpenKnowledge={onOpenKnowledge} />

      <section>
        <SectionHeading
          icon={<MessageSquare className="size-4" />}
          title="Conversation notes"
          hint="Short summaries written as a conversation grows. They keep long threads usable."
        />
        {allSummaries.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border px-5 py-6 text-center">
            <p className="text-sm text-muted-foreground">
              No notes yet. One is written automatically once a conversation gets long.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {groupedSummaries.map(group => (
              <div key={group.key}>
                <h4 className="mb-1.5 px-1 text-xs font-medium text-muted-foreground">{group.label}</h4>
                <div className="flex flex-col gap-2.5">
                  {group.items.map(s => (
                    <NoteCard key={s.id} summary={s.summary} live={s.id === "live-session"} turns={s.turnsCovered} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
