"use client";

import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { categoryLabel } from "@/lib/pii";

export type DetectionLogRecord = {
  id: string;
  category: string;
  context: string;
};

export type DetectionLogEntry = {
  at: string;
  turn: number;
  workspaceId?: string;
  source?: "chat" | "document";
  documentName?: string;
};

export type DetectionLogItem = {
  entry: DetectionLogEntry;
  rec: DetectionLogRecord;
};

export type DetectionLogGroup = {
  dayKey: string;
  label: string;
  items: DetectionLogItem[];
};

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const that = new Date(d);
  that.setHours(0, 0, 0, 0);
  const diff = (today.getTime() - that.getTime()) / 86_400_000;
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

export function groupDetectionLog(
  items: DetectionLogItem[],
  dismissedIds: Set<string>,
  includeDismissed: boolean,
): DetectionLogGroup[] {
  const map = new Map<string, DetectionLogGroup>();
  for (const item of items) {
    if (!includeDismissed && dismissedIds.has(item.rec.id)) continue;
    const dayKey = new Date(item.entry.at).toDateString();
    if (!map.has(dayKey)) {
      map.set(dayKey, { dayKey, label: dayLabel(item.entry.at), items: [] });
    }
    map.get(dayKey)!.items.push(item);
  }
  return [...map.values()]
    .sort((a, b) => new Date(b.dayKey).getTime() - new Date(a.dayKey).getTime())
    .map(g => ({
      ...g,
      items: [...g.items].sort(
        (a, b) => new Date(b.entry.at).getTime() - new Date(a.entry.at).getTime(),
      ),
    }));
}

function formatMsgTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function DetectionLog({
  groups,
  workspaceName,
  dismissedIds,
  highlightedId,
  emptyLabel = "No detections recorded for this time range.",
  onDismiss,
  onDelete,
  onOpenSafeTerms,
}: {
  groups: DetectionLogGroup[];
  workspaceName: (workspaceId?: string) => { name: string; emoji?: string };
  dismissedIds: Set<string>;
  highlightedId?: string | null;
  emptyLabel?: string;
  onDismiss: (recordId: string) => void;
  onDelete: (recordId: string) => void;
  onOpenSafeTerms?: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-foreground/8 bg-foreground/[0.02] px-4 py-3 text-[0.68rem] text-foreground/45 leading-relaxed space-y-1.5">
        <p>
          <span className="font-medium text-foreground/70">Dismiss</span>
          {" — "}hide this row from the log. Turn on “Show dismissed” to see it again. The
          document and any redaction stay as they are.
        </p>
        <p>
          <span className="font-medium text-foreground/70">Delete</span>
          {" — "}remove this log row from this browser. It does not delete the Knowledge file,
          undo a redaction, or change what will be detected next time.
        </p>
        <p className="text-foreground/35">
          Neither action is a whitelist. Detected values are not kept, so they cannot be marked
          safe from a record.
        </p>
        {onOpenSafeTerms && (
          <button
            type="button"
            onClick={onOpenSafeTerms}
            className="mt-1 text-[0.68rem] font-medium text-indigo-300/85 hover:text-indigo-200 cursor-pointer"
          >
            Add a Safe term in Settings
          </button>
        )}
      </div>

      {groups.length === 0 ? (
        <div className="rounded-2xl border border-foreground/8 bg-foreground/[0.03] px-6 py-10 text-center">
          <p className="text-sm text-foreground/40">{emptyLabel}</p>
        </div>
      ) : (
        groups.map(({ dayKey, label, items }) => (
          <section key={dayKey}>
            <div className="flex items-center gap-3 mb-3">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground/45 shrink-0">
                {label}
              </h3>
              <div className="flex-1 h-px bg-foreground/[0.06]" />
              <span className="text-[0.65rem] text-foreground/25 tabular-nums">
                {items.length} event{items.length !== 1 ? "s" : ""}
              </span>
            </div>
            <ul className="space-y-2 border-l-2 border-foreground/[0.08] ml-2 pl-4">
              {items.map(({ entry, rec }) => {
                const isDismissed = dismissedIds.has(rec.id);
                const ag = workspaceName(entry.workspaceId);
                return (
                  <li
                    key={rec.id}
                    id={`pii-record-${rec.id}`}
                    className={cn(
                      "rounded-xl border px-4 py-3 space-y-2 scroll-mt-24 transition-shadow duration-500",
                      highlightedId === rec.id && "ring-2 ring-indigo-500/60 shadow-lg shadow-indigo-500/10",
                      isDismissed
                        ? "bg-foreground/[0.02] border-foreground/[0.06] opacity-60"
                        : "bg-foreground/[0.04] border-foreground/[0.08]",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="inline-flex items-center rounded-full bg-red-400/10 border border-red-400/20 px-2 py-0.5 text-[0.62rem] text-red-400/80 font-medium uppercase tracking-wider">
                          {categoryLabel(rec.category)}
                        </span>
                        {isDismissed && (
                          <span className="text-[0.6rem] text-foreground/30">Dismissed</span>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-0.5 shrink-0">
                        <span className="inline-flex items-center gap-1 text-[0.62rem] text-foreground/40">
                          {ag.emoji && <span aria-hidden>{ag.emoji}</span>}
                          {ag.name}
                        </span>
                        <span className="text-[0.65rem] text-foreground/30 tabular-nums">
                          {formatMsgTime(entry.at)}
                          {entry.source === "document"
                            ? ` · Document${entry.documentName ? `: ${entry.documentName}` : ""}`
                            : ` · Turn ${entry.turn}`}
                        </span>
                      </div>
                    </div>
                    <p className="text-[0.75rem] text-foreground/50 font-mono leading-relaxed break-all">
                      {rec.context}
                    </p>
                    <div className="flex flex-wrap items-start gap-x-4 gap-y-2 pt-1">
                      {!isDismissed && (
                        <button
                          type="button"
                          onClick={() => onDismiss(rec.id)}
                          aria-label="Dismiss: hide this log row. You can show it again with Show dismissed."
                          className="text-left cursor-pointer group"
                        >
                          <span className="block text-[0.65rem] font-medium text-foreground/55 group-hover:text-foreground/80">
                            Dismiss this row
                          </span>
                          <span className="block text-[0.58rem] text-foreground/30 group-hover:text-foreground/45">
                            Hide it · Show dismissed brings it back
                          </span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onDelete(rec.id)}
                        aria-label="Delete log row: remove it from this browser. Does not delete the document or undo redaction."
                        className="text-left cursor-pointer group inline-flex items-start gap-1"
                      >
                        <Trash2 className="size-3 mt-0.5 text-red-400/50 group-hover:text-red-400/80" aria-hidden />
                        <span>
                          <span className="block text-[0.65rem] font-medium text-red-400/70 group-hover:text-red-400/90">
                            Delete this log row
                          </span>
                          <span className="block text-[0.58rem] text-red-400/35 group-hover:text-red-400/55">
                            Remove from this browser · file is not deleted
                          </span>
                        </span>
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
