"use client";

import { FileText, Image as ImageIcon, ShieldCheck, Sheet as SheetIcon, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  categoryLabel,
  percent,
  sourceLabel,
  type MemoryOverview,
  type MemoryOverviewDocument,
} from "@/lib/memory/overview-types";

/** Loads the workspace overview. A failed load leaves the cards in their empty state. */
export function useMemoryOverview(workspaceId: string | null | undefined, skip: boolean) {
  const [state, setState] = useState<{ id: string; data: MemoryOverview | null } | null>(null);

  useEffect(() => {
    if (skip || !workspaceId) return;
    let cancelled = false;
    fetch(`/api/memory/overview?workspaceId=${encodeURIComponent(workspaceId)}`, { credentials: "same-origin" })
      .then(r => (r.ok ? (r.json() as Promise<MemoryOverview>) : null))
      .then(body => {
        if (!cancelled) setState({ id: workspaceId, data: body });
      })
      .catch(() => {
        if (!cancelled) setState({ id: workspaceId, data: null });
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, skip]);

  const current = state && state.id === workspaceId ? state : null;
  return { data: current?.data ?? null, loading: !skip && !!workspaceId && !current };
}

export function SectionHeading({
  icon,
  title,
  hint,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-3 mb-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground shrink-0" aria-hidden>{icon}</span>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        </div>
        {hint && <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

function RateRow({ label, hint, rate }: { label: string; hint: string; rate: number | null }) {
  const pct = percent(rate);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm text-foreground">{label}</p>
        <p className="text-sm font-semibold tabular-nums text-foreground">{pct === null ? "—" : `${pct}%`}</p>
      </div>
      <div className="mt-1.5 h-1.5 rounded-full bg-muted overflow-hidden" aria-hidden>
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct ?? 0}%` }} />
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

export function EvidenceCard({ evidence, loading }: { evidence: MemoryOverview["evidence"]; loading: boolean }) {
  return (
    <div className="rounded-2xl border border-border bg-card px-5 py-4 h-full">
      <SectionHeading
        icon={<Sparkles className="size-4" />}
        title="How answers use your Knowledge"
        hint="Across everything asked in this workspace."
      />
      {evidence ? (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            <span className="text-2xl font-semibold tabular-nums text-foreground mr-1.5">{evidence.answers}</span>
            answer{evidence.answers === 1 ? "" : "s"} so far
          </p>
          <RateRow label="Searched your files" hint="Replies where relevant passages were found." rate={evidence.usedKnowledgeRate} />
          <RateRow label="Cited a source" hint="Replies that point to a document by number." rate={evidence.citedRate} />
          <RateRow label="Backed by sources" hint="Of the replies that needed sources, how many were fully covered." rate={evidence.groundedRate} />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground leading-relaxed">
          {loading
            ? "Loading…"
            : "No answers recorded yet. Once you chat, this shows how often replies drew on your uploaded files."}
        </p>
      )}
    </div>
  );
}

export function PrivacyCard({ privacy, loading }: { privacy: MemoryOverview["privacy"]; loading: boolean }) {
  return (
    <div className="rounded-2xl border border-border bg-card px-5 py-4 h-full">
      <SectionHeading
        icon={<ShieldCheck className="size-4" />}
        title="Sensitive values replaced here"
        hint="Detected and replaced before sending or indexing. Best effort."
      />
      {privacy ? (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            <span className="text-2xl font-semibold tabular-nums text-foreground mr-1.5">{privacy.itemsReplaced}</span>
            value{privacy.itemsReplaced === 1 ? "" : "s"} replaced
          </p>
          {privacy.byCategory.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label="Replaced by category">
              {privacy.byCategory.map(c => (
                <li
                  key={c.category}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary px-2.5 py-1 text-xs text-foreground"
                >
                  {categoryLabel(c.category)}
                  <span className="tabular-nums text-muted-foreground">{c.count}</span>
                </li>
              ))}
            </ul>
          )}
          {privacy.bySource.length > 0 && (
            <dl className="space-y-1.5 border-t border-border pt-3">
              {privacy.bySource.map(s => (
                <div key={s.source} className="flex items-center justify-between gap-3 text-sm">
                  <dt className="text-muted-foreground">{sourceLabel(s.source)}</dt>
                  <dd className="tabular-nums text-foreground">{s.count}</dd>
                </div>
              ))}
            </dl>
          )}
          <p className="text-xs text-muted-foreground leading-relaxed">
            Detection can miss things. Keep reviewing what you send and what you upload.
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground leading-relaxed">
          {loading ? "Loading…" : "Nothing has been replaced in this workspace so far."}
        </p>
      )}
    </div>
  );
}

function docIcon(mimeType: string) {
  if (mimeType.startsWith("image/")) return <ImageIcon className="size-4" aria-hidden />;
  if (mimeType === "text/csv" || mimeType.includes("spreadsheet") || mimeType === "application/vnd.ms-excel") {
    return <SheetIcon className="size-4" aria-hidden />;
  }
  return <FileText className="size-4" aria-hidden />;
}

function statusPill(status: string) {
  if (status === "ready") return { label: "Ready", cls: "border-[var(--success-border)] bg-[var(--success-soft)] text-success" };
  if (status === "failed") return { label: "Needs attention", cls: "border-[var(--destructive-border)] bg-[var(--destructive-soft)] text-destructive" };
  return { label: "Processing", cls: "border-[var(--warning-border)] bg-[var(--warning-soft)] text-warning" };
}

function addedOn(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function KnowledgeLibrary({
  documents,
  loading,
  onOpenKnowledge,
}: {
  documents: MemoryOverviewDocument[];
  loading: boolean;
  onOpenKnowledge?: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? documents : documents.slice(0, 6);
  return (
    <section>
      <SectionHeading
        icon={<FileText className="size-4" />}
        title="Knowledge library"
        hint="Files this workspace can search and cite. They are sources, not facts about you."
        action={
          onOpenKnowledge ? (
            <button
              type="button"
              onClick={onOpenKnowledge}
              className="shrink-0 text-xs font-medium text-foreground underline underline-offset-4 hover:text-primary cursor-pointer"
            >
              Manage in Knowledge
            </button>
          ) : undefined
        }
      />
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        {documents.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground leading-relaxed">
            {loading
              ? "Loading…"
              : "No files yet. Upload a file in Knowledge and replies can search it and cite it."}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {visible.map(d => {
              const pill = statusPill(d.status);
              return (
                <li key={d.id} className="flex items-center gap-3 px-4 py-3">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
                    {docIcon(d.mimeType)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{d.name}</p>
                    <p className="text-xs text-muted-foreground">
                      Added {addedOn(d.createdAt)}
                      {d.chunkCount > 0 && ` · ${d.chunkCount} searchable passage${d.chunkCount === 1 ? "" : "s"}`}
                      {d.redactionCount > 0 && ` · ${d.redactionCount} value${d.redactionCount === 1 ? "" : "s"} replaced`}
                    </p>
                  </div>
                  <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium", pill.cls)}>
                    {pill.label}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {documents.length > 6 && (
          <button
            type="button"
            onClick={() => setShowAll(v => !v)}
            className="w-full border-t border-border px-4 py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground cursor-pointer"
          >
            {showAll ? "Show fewer" : `Show all ${documents.length} files`}
          </button>
        )}
      </div>
    </section>
  );
}
