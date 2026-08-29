"use client";

/**
 * Insights rail tab strip — Security / Usage / Cost.
 * Order is per-browser (localStorage). Drag any tab to reorder.
 * Drop feedback is an insert line between tabs (not a “nest into” highlight).
 */

import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { BarChart2, GripVertical, Shield, Wallet } from "lucide-react";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export type InsightsTabId = "security" | "context" | "savings";

export const INSIGHTS_TAB_ORDER_KEY = "sm_insights_tab_order_v2";

/** Models first — routing / model picker is the primary day-to-day control. */
export const DEFAULT_INSIGHTS_TAB_ORDER: InsightsTabId[] = [
  "context",
  "security",
  "savings",
];

const TAB_META: Record<
  InsightsTabId,
  { label: string; icon: typeof Shield }
> = {
  security: { label: "Security", icon: Shield },
  /** Rail label: model routing + tier activity (not the full Usage analytics page). */
  context: { label: "Models", icon: BarChart2 },
  savings: { label: "Cost", icon: Wallet },
};

function isInsightsTabId(v: unknown): v is InsightsTabId {
  return v === "security" || v === "context" || v === "savings";
}

export function normalizeInsightsTabOrder(raw: unknown): InsightsTabId[] {
  if (!Array.isArray(raw)) return [...DEFAULT_INSIGHTS_TAB_ORDER];
  const seen = new Set<InsightsTabId>();
  const ordered: InsightsTabId[] = [];
  for (const item of raw) {
    if (isInsightsTabId(item) && !seen.has(item)) {
      seen.add(item);
      ordered.push(item);
    }
  }
  for (const id of DEFAULT_INSIGHTS_TAB_ORDER) {
    if (!seen.has(id)) ordered.push(id);
  }
  return ordered;
}

export function loadInsightsTabOrder(): InsightsTabId[] {
  if (typeof window === "undefined") return [...DEFAULT_INSIGHTS_TAB_ORDER];
  try {
    const raw = localStorage.getItem(INSIGHTS_TAB_ORDER_KEY);
    if (!raw) return [...DEFAULT_INSIGHTS_TAB_ORDER];
    return normalizeInsightsTabOrder(JSON.parse(raw) as unknown);
  } catch {
    return [...DEFAULT_INSIGHTS_TAB_ORDER];
  }
}

export function saveInsightsTabOrder(order: InsightsTabId[]): void {
  try {
    localStorage.setItem(INSIGHTS_TAB_ORDER_KEY, JSON.stringify(order));
  } catch {
    /* quota / private */
  }
}

/** Insert `sourceId` before `insertBefore` in `order` (0…length). */
export function reorderInsightsTab(
  order: InsightsTabId[],
  sourceId: InsightsTabId,
  insertBefore: number,
): InsightsTabId[] {
  const from = order.indexOf(sourceId);
  if (from < 0) return order;
  let to = Math.max(0, Math.min(insertBefore, order.length));
  if (from < to) to -= 1;
  if (to === from) return order;
  const next = order.filter(id => id !== sourceId);
  next.splice(to, 0, sourceId);
  return next;
}

export function useInsightsTabOrder(): [
  InsightsTabId[],
  (next: InsightsTabId[]) => void,
] {
  const [order, setOrderState] = useState<InsightsTabId[]>(
    () => [...DEFAULT_INSIGHTS_TAB_ORDER],
  );

  useEffect(() => {
    setOrderState(loadInsightsTabOrder());
  }, []);

  const setOrder = useCallback((next: InsightsTabId[]) => {
    const normalized = normalizeInsightsTabOrder(next);
    setOrderState(normalized);
    saveInsightsTabOrder(normalized);
  }, []);

  return [order, setOrder];
}

/** Vertical insert marker — sits between tabs, not “inside” one. */
function VerticalInsertLine() {
  return (
    <div
      role="presentation"
      className="pointer-events-none absolute inset-y-1 left-1/2 z-30 flex -translate-x-1/2 flex-col items-center gap-1"
    >
      <span
        aria-hidden
        className="size-2 shrink-0 rounded-full bg-indigo-400 shadow-[0_0_10px_rgba(129,140,248,0.95)]"
      />
      <span
        aria-hidden
        className="w-[3px] flex-1 rounded-full bg-indigo-400 shadow-[0_0_12px_rgba(129,140,248,0.85)]"
      />
      <span
        aria-hidden
        className="size-2 shrink-0 rounded-full bg-indigo-400 shadow-[0_0_10px_rgba(129,140,248,0.95)]"
      />
    </div>
  );
}

export function InsightsTabsList({
  order,
  onReorder,
  securityBadge,
}: {
  order: InsightsTabId[];
  onReorder: (next: InsightsTabId[]) => void;
  /** Active redaction count shown on the Security tab. */
  securityBadge?: number;
}) {
  const [dragId, setDragId] = useState<InsightsTabId | null>(null);
  /** Insert before this index (0…order.length). */
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const dropIndexRef = useRef<number | null>(null);
  const tabRefs = useRef<Record<string, HTMLElement | null>>({});

  const updateDropIndex = useCallback((next: number | null) => {
    dropIndexRef.current = next;
    setDropIndex(prev => (prev === next ? prev : next));
  }, []);

  const onDragStart = useCallback((id: InsightsTabId, e: DragEvent) => {
    setDragId(id);
    updateDropIndex(null);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
  }, [updateDropIndex]);

  /** Map pointer X over a tab to insert-before index (bias toward “after”). */
  const setDropFromTab = useCallback((tabIndex: number, e: DragEvent, el: HTMLElement) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const rect = el.getBoundingClientRect();
    // Left ~35% → line before; rest → line after (feels like beside, not into).
    const ratio = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 1;
    const next = ratio < 0.35 ? tabIndex : tabIndex + 1;
    updateDropIndex(next);
  }, [updateDropIndex]);

  const commitDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData("text/plain");
    const source =
      dragId
      ?? (isInsightsTabId(raw) ? raw : null);
    const at = dropIndexRef.current;
    setDragId(null);
    updateDropIndex(null);
    if (!source || at == null) return;
    onReorder(reorderInsightsTab(order, source, at));
  }, [dragId, onReorder, order, updateDropIndex]);

  const onDragEnd = useCallback(() => {
    setDragId(null);
    updateDropIndex(null);
  }, [updateDropIndex]);

  const reordering = dragId != null;

  return (
    <TabsList
      aria-label="Insights sections. Drag a tab to change order."
      title="Drag a tab to reorder"
      className={cn(
        "flex w-full shrink-0 !h-auto min-h-0 items-stretch p-1.5 gap-0",
        "group-data-horizontal/tabs:!h-auto",
        "bg-muted border border-border rounded-xl",
      )}
    >
      {order.map((id, index) => {
        const meta = TAB_META[id];
        const Icon = meta.icon;
        const dragging = dragId === id;
        const showLineBefore = reordering && dropIndex === index;

        return (
          <div key={id} className="contents">
            {/* Drop gap before each tab — wider while dragging so the line sits between */}
            <div
              className={cn(
                "relative shrink-0 self-stretch transition-[width] duration-100",
                reordering ? "w-2.5" : "w-0",
              )}
              onDragOver={e => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                updateDropIndex(index);
              }}
              onDrop={commitDrop}
            >
              {showLineBefore && <VerticalInsertLine />}
            </div>

            <TabsTrigger
              value={id}
              draggable
              ref={el => {
                // Base UI Tab may forward ref; fall back via currentTarget in handlers.
                tabRefs.current[id] = el as HTMLElement | null;
              }}
              onDragStart={e => onDragStart(id, e)}
              onDragOver={e => {
                const el =
                  tabRefs.current[id]
                  ?? (e.currentTarget as HTMLElement);
                setDropFromTab(index, e, el);
              }}
              onDrop={commitDrop}
              onDragEnd={onDragEnd}
              className={cn(
                "group/tab relative flex h-auto min-h-[3.4rem] flex-1 flex-col items-center justify-center gap-1",
                "rounded-lg px-1.5 py-2.5 text-[0.72rem] font-semibold leading-none cursor-grab",
                "active:cursor-grabbing data-active:shadow-sm",
                dragging && "opacity-40 scale-[0.97]",
              )}
            >
              <GripVertical
                aria-hidden
                className="pointer-events-none absolute left-1 top-1 size-3 text-foreground/25 opacity-0 transition-opacity group-hover/tab:opacity-80"
              />
              <Icon aria-hidden className="size-3.5 shrink-0 opacity-80" />
              <span className="inline-flex items-center gap-1">
                {meta.label}
                {id === "security" && securityBadge != null && securityBadge > 0 && (
                  <span className="inline-flex size-4 items-center justify-center rounded-full bg-primary text-[0.55rem] text-primary-foreground font-bold tabular-nums">
                    {securityBadge > 99 ? "99+" : securityBadge}
                  </span>
                )}
              </span>
            </TabsTrigger>
          </div>
        );
      })}

      {/* Final drop gap — line after the last tab */}
      <div
        className={cn(
          "relative shrink-0 self-stretch transition-[width] duration-100",
          reordering ? "w-3" : "w-0",
        )}
        onDragOver={e => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          updateDropIndex(order.length);
        }}
        onDrop={commitDrop}
      >
        {reordering && dropIndex === order.length && <VerticalInsertLine />}
      </div>
    </TabsList>
  );
}
