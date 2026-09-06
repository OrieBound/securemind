"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { categoryLabel } from "@/lib/pii";

export const DETECTION_LOG_DAY_PAGE = 7;
export const DETECTION_LOG_ITEM_PAGE = 20;

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
  const [daysShown, setDaysShown] = useState(DETECTION_LOG_DAY_PAGE);
  const [openDays, setOpenDays] = useState<Set<string>>(new Set());
  const [expandedItemDays, setExpandedItemDays] = useState<Set<string>>(new Set());
  const seeded = useRef(false);

  useEffect(() => {
    if (seeded.current || groups.length === 0) return;
    seeded.current = true;
    setOpenDays(new Set(groups.slice(0, 1).map(g => g.dayKey)));
  }, [groups]);

  useEffect(() => {
    if (!highlightedId) return;
    const hit = groups.find(g => g.items.some(i => i.rec.id === highlightedId));
    if (!hit) return;
    setOpenDays(prev => new Set(prev).add(hit.dayKey));
    const dayIndex = groups.findIndex(g => g.dayKey === hit.dayKey);
    if (dayIndex >= daysShown) setDaysShown(dayIndex + 1);
    const itemIndex = hit.items.findIndex(i => i.rec.id === highlightedId);
    if (itemIndex >= DETECTION_LOG_ITEM_PAGE) {
      setExpandedItemDays(prev => new Set(prev).add(hit.dayKey));
    }
  }, [highlightedId, groups, daysShown]);

  const visibleGroups = useMemo(
    () => groups.slice(0, daysShown),
    [groups, daysShown],
  );
  const hiddenDayCount = Math.max(0, groups.length - visibleGroups.length);

  const toggleDay = (dayKey: string) => {
    setOpenDays(prev => {
      const next = new Set(prev);
      if (next.has(dayKey)) next.delete(dayKey);
      else next.add(dayKey);
      return next;
    });
  };

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
        <>
        {visibleGroups.map(({ dayKey, label, items }) => {
          const open = openDays.has(dayKey);
          const showAllItems = expandedItemDays.has(dayKey);
          const visibleItems = showAllItems ? items : items.slice(0, DETECTION_LOG_ITEM_PAGE);
          const hiddenItemCount = items.length - visibleItems.length;
          return (
          <section key={dayKey} className="rounded-xl border border-foreground/8 bg-foreground/[0.02]">
            <button
              type="button"
              aria-expanded={open}
              onClick={() => toggleDay(dayKey)}
              className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left cursor-pointer hover:bg-foreground/[0.04] rounded-xl"
            >
              <ChevronDown
                className={cn(
                  "size-3.5 shrink-0 text-foreground/40 transition-transform",
                  !open && "-rotate-90",
                )}
                aria-hidden
              />
              <h3 className="text-xs font-semibold uppercase tracking-wider text-foreground/70">
                {label}
              </h3>
              <div className="flex-1 h-px bg-foreground/[0.06]" />
              <span className="text-[0.65rem] text-foreground/40 tabular-nums">
                {items.length} event{items.length !== 1 ? "s" : ""}
              </span>
            </button>
            {open && (
            <ul className="space-y-2 border-t border-foreground/[0.06] px-3.5 py-3">
              {visibleItems.map(({ entry, rec }) => {
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
              {hiddenItemCount > 0 && (
                <li>
                  <button
                    type="button"
                    onClick={() => setExpandedItemDays(prev => new Set(prev).add(dayKey))}
                    className="w-full rounded-lg border border-foreground/10 bg-foreground/[0.03] px-3 py-2 text-[0.72rem] font-medium text-foreground/65 hover:bg-foreground/[0.06] cursor-pointer"
                  >
                    Show {hiddenItemCount} more on {label}
                  </button>
                </li>
              )}
            </ul>
            )}
          </section>
          );
        })}
        {hiddenDayCount > 0 && (
          <button
            type="button"
            onClick={() => setDaysShown(n => n + DETECTION_LOG_DAY_PAGE)}
            className="w-full rounded-xl border border-foreground/10 bg-foreground/[0.03] px-4 py-3 text-sm font-medium text-foreground/70 hover:bg-foreground/[0.06] cursor-pointer"
          >
            Show {Math.min(DETECTION_LOG_DAY_PAGE, hiddenDayCount)} older day
            {Math.min(DETECTION_LOG_DAY_PAGE, hiddenDayCount) === 1 ? "" : "s"}
            {` · ${hiddenDayCount} remaining`}
          </button>
        )}
        </>
      )}
    </div>
  );
}
