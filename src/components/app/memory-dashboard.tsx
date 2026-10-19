"use client";

import {
  Brain,
  FileText,
  Layers,
  Loader2,
  MessageSquare,
  User,
} from "lucide-react";
import { useMemo, useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { formatFactValue, humanizeKey } from "@/lib/memory/format";
import { buildFactAssociations, categoryLabel as factCategoryLabel, type FactAssociation } from "@/lib/memory/fact-graph";

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

const PREFERENCE_KEYS = new Set([
  "preferred_response_length",
  "response_length",
  "technical_level",
]);

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

type AccountSnapshot = {
  displayName: string | null;
  handle: string | null;
  jobTitle: string | null;
  bio: string | null;
  email: string | null;
};

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
  const [selectedFactId, setSelectedFactId] = useState<string | null>(null);
  const [account, setAccount] = useState<AccountSnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/me/profile", { credentials: "same-origin" })
      .then(r => (r.ok ? r.json() : null))
      .then((body: { profile?: AccountSnapshot } | null) => {
        if (cancelled || !body?.profile) return;
        setAccount({
          displayName: body.profile.displayName ?? null,
          handle: body.profile.handle ?? null,
          jobTitle: body.profile.jobTitle ?? null,
          bio: body.profile.bio ?? null,
          email: body.profile.email ?? null,
        });
      })
      .catch(() => { /* profile is optional chrome */ });
    return () => { cancelled = true; };
  }, []);

  const allFacts = useMemo(
    () => mergeLiveFacts(workspaceFacts, isActiveWorkspace ? liveFacts : {}),
    [workspaceFacts, liveFacts, isActiveWorkspace],
  );

  const visibleFacts = useMemo(
    () => allFacts.filter(f => formatFactValue(f.value) !== "—" && !f.forgotten),
    [allFacts],
  );

  const identityFacts = useMemo(
    () => visibleFacts.filter(f => IDENTITY_KEYS.has(f.key.toLowerCase())),
    [visibleFacts],
  );

  const preferenceFacts = useMemo(
    () => visibleFacts.filter(f => PREFERENCE_KEYS.has(f.key.toLowerCase())),
    [visibleFacts],
  );

  const otherFacts = useMemo(
    () => visibleFacts.filter(f =>
      !IDENTITY_KEYS.has(f.key.toLowerCase()) && !PREFERENCE_KEYS.has(f.key.toLowerCase()),
    ),
    [visibleFacts],
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

  const rawTurns = isActiveWorkspace
    ? Math.max(0, messageCount - summarizedCount)
    : 0;

  const accountLines = account
    ? [
        account.displayName && { label: "Display name", value: account.displayName },
        account.jobTitle && { label: "Job title", value: account.jobTitle },
        account.handle && { label: "Handle", value: `@${account.handle}` },
        account.email && { label: "Email", value: account.email },
        account.bio && { label: "Bio", value: account.bio },
      ].filter(Boolean) as { label: string; value: string }[]
    : [];

  const knowledgeChunks = memoryStats?.documentFragmentCount ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-xl border border-foreground/[0.06] bg-foreground/[0.02] px-4 py-3.5 space-y-2">
        <p className="text-sm text-foreground/55 leading-relaxed">
          This is what{" "}
          <span className="text-foreground/80 font-medium">{workspaceName}</span>
          {" "}has actually retained — not a personality profile. Facts come only from what you
          say in chat. Assistant replies, Knowledge files, and guesses are not stored as “who you are.”
        </p>
        <p className="text-[0.72rem] text-foreground/32 leading-relaxed">
          Pin or correct a fact if it is wrong. Forgotten facts stay saved but are hidden from chat.
        </p>
      </div>

      {memoryLoading && (
        <div className="flex items-center gap-2 text-sm text-foreground/35">
          <Loader2 className="size-4 animate-spin shrink-0" aria-hidden />
          Reading what this workspace has stored…
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <StatCard label="Learned about you" value={visibleFacts.length} hint="From what you said" accent="violet" />
        <StatCard label="Conversation notes" value={allSummaries.length} hint="Saved thread summaries" accent="indigo" />
        <StatCard
          label="Still in this thread"
          value={isActiveWorkspace ? rawTurns : "—"}
          hint={isActiveWorkspace ? "Messages not yet compressed" : "Open Chat to see live turns"}
          accent="emerald"
        />
        <StatCard
          label="Knowledge chunks"
          value={knowledgeChunks}
          hint="Indexed files — not facts about you"
          accent="amber"
        />
      </div>

      <section>
        <div className="flex items-center gap-2 mb-3">
          <User className="size-4 text-violet-400/70" aria-hidden />
          <h3 className="text-[0.65rem] uppercase tracking-[0.22em] text-foreground/35 font-semibold">
            How {workspaceName} sees you
          </h3>
        </div>
        <div className="rounded-2xl border border-foreground/[0.07] bg-foreground/[0.03] overflow-hidden">
          {visibleFacts.length === 0 ? (
            <div className="px-4 py-8 text-center space-y-2">
              <Brain className="size-8 text-violet-400/25 mx-auto" aria-hidden />
              <p className="text-sm text-foreground/50">Nothing durable has been saved from chat yet.</p>
              <p className="text-[0.72rem] text-foreground/32 leading-relaxed max-w-md mx-auto">
                After you send a message, SecureMind looks for things you stated about yourself
                (name, work, location, projects, how you like replies). A short “what do you think
                of Cursor?” chat will not fill this in — there was nothing autobiographical to keep.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-foreground/[0.05]">
              {identityFacts.length > 0 && identityFacts.map(f => (
                <FactRow
                  key={f.id}
                  fact={f}
                  live={f.id.startsWith("live-")}
                  selected={selectedFactId === f.id}
                  onSelect={fact => setSelectedFactId(fact.id)}
                />
              ))}
              {preferenceFacts.map(f => (
                <FactRow
                  key={f.id}
                  fact={f}
                  live={f.id.startsWith("live-")}
                  selected={selectedFactId === f.id}
                  onSelect={fact => setSelectedFactId(fact.id)}
                />
              ))}
              {otherFacts.map(f => (
                <FactRow
                  key={f.id}
                  fact={f}
                  live={f.id.startsWith("live-")}
                  selected={selectedFactId === f.id}
                  onSelect={fact => setSelectedFactId(fact.id)}
                />
              ))}
            </div>
          )}
        </div>
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

      <section>
        <div className="flex items-center gap-2 mb-3">
          <User className="size-4 text-foreground/40" aria-hidden />
          <h3 className="text-[0.65rem] uppercase tracking-[0.22em] text-foreground/35 font-semibold">
            From Profile
          </h3>
        </div>
        <div className="rounded-2xl border border-foreground/[0.07] bg-foreground/[0.03] px-4 py-4">
          {accountLines.length === 0 ? (
            <p className="text-sm text-foreground/35 leading-relaxed">
              No display name, title, or bio yet. That lives in Settings → Profile and is
              account-wide — it is not copied into this workspace’s learned facts.
            </p>
          ) : (
            <>
              <dl className="space-y-2.5">
                {accountLines.map(row => (
                  <div key={row.label} className="flex flex-col sm:flex-row sm:gap-4">
                    <dt className="text-[0.68rem] uppercase tracking-wider text-foreground/35 sm:w-32 shrink-0 pt-0.5">
                      {row.label}
                    </dt>
                    <dd className="text-sm text-foreground/75 leading-relaxed">{row.value}</dd>
                  </div>
                ))}
              </dl>
              <p className="text-[0.65rem] text-foreground/28 mt-3 leading-relaxed">
                You wrote this in Settings. Chat does not treat it as a learned workspace fact
                unless you also say it in conversation.
              </p>
            </>
          )}
        </div>
      </section>

      <section>
        <div className="flex items-center gap-2 mb-3">
          <MessageSquare className="size-4 text-indigo-400/70" aria-hidden />
          <h3 className="text-[0.65rem] uppercase tracking-[0.22em] text-foreground/35 font-semibold">
            What it remembers from conversation
          </h3>
        </div>
        <div className="rounded-2xl border border-foreground/[0.07] bg-foreground/[0.03] px-4 py-4 space-y-3">
          {isActiveWorkspace && (
            <p className="text-[0.72rem] text-foreground/40">
              {rawTurns} message{rawTurns === 1 ? "" : "s"} in this thread {summarizedCount > 0
                ? `(${summarizedCount} older turns already compressed).`
                : "are still held in full — a rolling summary is written as the thread gets long."}
            </p>
          )}
          {liveSessionSummary.trim() ? (
            <p className="text-sm text-foreground/70 leading-relaxed border-l-2 border-indigo-400/40 pl-3">
              {liveSessionSummary}
            </p>
          ) : allSummaries.length === 0 ? (
            <p className="text-sm text-foreground/35 leading-relaxed">
              No saved notes yet. Recent messages stay in the chat thread. A summary appears here
              once the model has something durable from what you said — not from the assistant’s
              opinions (for example, a take on Cursor).
            </p>
          ) : null}
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <div className="flex items-center gap-2">
            <Layers className="size-4 text-foreground/40" aria-hidden />
            <h3 className="text-[0.65rem] uppercase tracking-[0.22em] text-foreground/35 font-semibold">
              Saved conversation notes
            </h3>
          </div>
          {allSummaries.length > 0 && (
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
          )}
        </div>
        {allSummaries.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-foreground/10 px-5 py-8 text-center">
            <p className="text-sm text-foreground/40">No archived summaries for this workspace yet.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {groupedSummaries.map(group => (
              <div key={group.key}>
                <h4 className="mb-2 text-[0.65rem] uppercase tracking-[0.2em] text-foreground/28 font-semibold">
                  {group.label}
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
                        </div>
                        <p className="text-sm text-foreground/60 leading-relaxed">{s.summary}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="flex items-center gap-2 mb-3">
          <FileText className="size-4 text-amber-400/70" aria-hidden />
          <h3 className="text-[0.65rem] uppercase tracking-[0.22em] text-foreground/35 font-semibold">
            Knowledge in this workspace
          </h3>
        </div>
        <div className="rounded-2xl border border-foreground/[0.07] bg-foreground/[0.03] px-4 py-4">
          <p className="text-sm text-foreground/60 leading-relaxed">
            {knowledgeChunks === 0
              ? "No Knowledge files are indexed here yet. Uploads become searchable sources with citations — they are not listed as facts about you."
              : `${knowledgeChunks} document chunk${knowledgeChunks === 1 ? "" : "s"} are indexed for citations in chat. That is workspace Knowledge, not a profile of you.`}
          </p>
        </div>
      </section>
    </div>
  );
}
