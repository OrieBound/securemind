"use client";

/**
 * VS Code–style Insights modules: collapsible headers + drag-to-resize sashes
 * + drag-to-reorder section order (persisted per stack in localStorage).
 *
 * Heights are stored in pixels so each module can default to a content-fit size,
 * and dragging never "jumps" when inventing slack weights.
 */

import { ChevronRight, GripVertical } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from "react";
import { cn } from "@/lib/utils";

export type IntelPanelDef = {
  id: string;
  label: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  /** Omit from the stack when false. */
  visible?: boolean;
  /** A small control in the header, to the right (for example a refresh button). */
  headerAction?: React.ReactNode;
  /**
   * Preferred body height in px on first visit.
   * Compact summaries should stay tight (~168); pickers can be taller.
   */
  defaultHeight?: number;
};

type LayoutState = {
  open: Record<string, boolean>;
  /** Body height (below the header) in pixels for each panel. */
  heights: Record<string, number>;
  /** Visible panel ids top → bottom. */
  order: string[];
};

const HEADER_H = 34;
const SASH_H = 12;
const MIN_BODY = 64;
const DEFAULT_NORMAL = 220;

function defaultHeightFor(panel: IntelPanelDef): number {
  return panel.defaultHeight ?? DEFAULT_NORMAL;
}

/** Keep saved order, append any new panel ids, drop unknowns. */
export function normalizePanelOrder(
  saved: unknown,
  panelIds: string[],
): string[] {
  const idSet = new Set(panelIds);
  const ordered: string[] = [];
  if (Array.isArray(saved)) {
    for (const id of saved) {
      if (typeof id === "string" && idSet.has(id) && !ordered.includes(id)) {
        ordered.push(id);
      }
    }
  }
  for (const id of panelIds) {
    if (!ordered.includes(id)) ordered.push(id);
  }
  return ordered;
}

function loadLayout(
  key: string,
  panels: IntelPanelDef[],
  defaultOrder?: string[],
): LayoutState {
  const panelIds = panels.map(p => p.id);
  const defaults: LayoutState = {
    open: Object.fromEntries(panels.map(p => [p.id, p.defaultOpen !== false])),
    heights: Object.fromEntries(panels.map(p => [p.id, defaultHeightFor(p)])),
    order: normalizePanelOrder(defaultOrder ?? panelIds, panelIds),
  };
  if (typeof window === "undefined") return defaults;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<LayoutState> & {
      /** Legacy weight-based layout — ignore and use fresh pixel defaults. */
      weights?: unknown;
      slack?: unknown;
    };
    // Old weight/slack shape produced the "giant empty summary" feel — reset it.
    if (parsed.weights && !parsed.heights) return defaults;

    const heights = { ...defaults.heights };
    if (parsed.heights && typeof parsed.heights === "object") {
      for (const [id, h] of Object.entries(parsed.heights)) {
        if (typeof h === "number" && Number.isFinite(h) && h >= MIN_BODY) {
          heights[id] = Math.round(h);
        }
      }
    }
    return {
      open: { ...defaults.open, ...(parsed.open ?? {}) },
      heights,
      order: Array.isArray(parsed.order)
        ? normalizePanelOrder(parsed.order, panelIds)
        : defaults.order,
    };
  } catch {
    return defaults;
  }
}

/** Horizontal sash — same hover language as the sidebar edge handles. */
export function PanelResizeHandle({
  onPointerDown,
  active,
  label,
}: {
  onPointerDown: (e: React.PointerEvent) => void;
  active?: boolean;
  label: string;
}) {
  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label={label}
      title="Drag to resize"
      onPointerDown={onPointerDown}
      className="group/hsash relative z-20 h-3 shrink-0 cursor-row-resize touch-none flex items-center justify-center"
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-x-0 inset-y-0 transition-opacity duration-150",
          "bg-gradient-to-b from-indigo-400/0 via-indigo-400/25 to-indigo-400/0",
          active ? "opacity-100" : "opacity-0 group-hover/hsash:opacity-100",
        )}
      />
      <span
        aria-hidden
        className={cn(
          "pointer-events-none relative z-10 h-px w-full transition-all duration-150",
          active
            ? "bg-indigo-300/90 shadow-[0_0_10px_rgba(129,140,248,0.55)]"
            : "bg-foreground/8 group-hover/hsash:bg-indigo-300/80 group-hover/hsash:shadow-[0_0_8px_rgba(129,140,248,0.4)]",
        )}
      />
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2",
          "h-1 w-10 rounded-full transition-all duration-150",
          active
            ? "bg-indigo-300/90 scale-x-110"
            : "bg-foreground/15 group-hover/hsash:bg-indigo-300/85 group-hover/hsash:scale-x-110",
        )}
      />
    </div>
  );
}

export function IntelPanelStack({
  storageKey,
  panels,
  defaultOrder,
}: {
  storageKey: string;
  panels: IntelPanelDef[];
  /** First-visit / reset order (panel ids). Unknown ids ignored; missing ids append. */
  defaultOrder?: string[];
}) {
  const visible = useMemo(
    () => panels.filter(p => p.visible !== false),
    [panels],
  );
  const panelIds = visible.map(p => p.id).join("|");

  return (
    <IntelPanelStackInner
      key={`${storageKey}:${panelIds}`}
      storageKey={storageKey}
      panels={visible}
      defaultOrder={defaultOrder}
    />
  );
}

function IntelPanelStackInner({
  storageKey,
  panels,
  defaultOrder,
}: {
  storageKey: string;
  panels: IntelPanelDef[];
  defaultOrder?: string[];
}) {
  const [layout, setLayout] = useState<LayoutState>(() =>
    loadLayout(storageKey, panels, defaultOrder),
  );
  const [draggingSash, setDraggingSash] = useState<string | null>(null);
  const [dragPanelId, setDragPanelId] = useState<string | null>(null);
  /** Insert before this index in the current ordered list (0…length). */
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const dropIndexRef = useRef<number | null>(null);
  const suppressToggleClick = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const ready = useRef(false);

  const updateDropIndex = useCallback((next: number | null) => {
    dropIndexRef.current = next;
    setDropIndex(prev => (prev === next ? prev : next));
  }, []);

  const orderedPanels = useMemo(() => {
    const byId = new Map(panels.map(p => [p.id, p]));
    const order = normalizePanelOrder(layout.order, panels.map(p => p.id));
    return order
      .map(id => byId.get(id))
      .filter((p): p is IntelPanelDef => Boolean(p));
  }, [panels, layout.order]);

  useEffect(() => {
    ready.current = true;
  }, []);

  const panelIdsKey = panels.map(p => p.id).join("|");

  // Keep order in sync when panels appear/disappear (e.g. conditional Cost rows).
  useEffect(() => {
    const ids = panelIdsKey ? panelIdsKey.split("|") : [];
    setLayout(prev => {
      const next = normalizePanelOrder(prev.order, ids);
      if (next.join("|") === prev.order.join("|")) return prev;
      return { ...prev, order: next };
    });
  }, [panelIdsKey]);

  useEffect(() => {
    if (!ready.current || draggingSash) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(layout));
    } catch {
      /* quota */
    }
  }, [storageKey, layout, draggingSash]);

  const toggle = useCallback((id: string) => {
    setLayout(prev => ({
      ...prev,
      open: { ...prev.open, [id]: prev.open[id] === false },
    }));
  }, []);

  const reorderToIndex = useCallback((sourceId: string, insertBefore: number) => {
    setLayout(prev => {
      const order = normalizePanelOrder(prev.order, panels.map(p => p.id));
      const from = order.indexOf(sourceId);
      if (from < 0) return prev;
      let to = Math.max(0, Math.min(insertBefore, order.length));
      // Removing the source shifts later indices down by one.
      if (from < to) to -= 1;
      if (to === from) return prev;
      const next = order.filter(id => id !== sourceId);
      next.splice(to, 0, sourceId);
      return { ...prev, order: next };
    });
  }, [panels]);

  const onPanelDragStart = useCallback((id: string, e: DragEvent) => {
    setDragPanelId(id);
    updateDropIndex(null);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
  }, [updateDropIndex]);

  /** Map pointer Y over a row to an insert-before index (bias toward “below”). */
  const setDropFromRow = useCallback((rowIndex: number, e: DragEvent, el: HTMLElement) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const rect = el.getBoundingClientRect();
    // Top ~35% → line above; rest → line below (feels like “under”, not “into”).
    const ratio = rect.height > 0 ? (e.clientY - rect.top) / rect.height : 1;
    const next = ratio < 0.35 ? rowIndex : rowIndex + 1;
    updateDropIndex(next);
  }, [updateDropIndex]);

  const commitDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    const source =
      dragPanelId
      ?? e.dataTransfer.getData("text/plain");
    const at = dropIndexRef.current;
    setDragPanelId(null);
    updateDropIndex(null);
    if (!source || at == null) return;
    suppressToggleClick.current = true;
    reorderToIndex(source, at);
  }, [dragPanelId, reorderToIndex, updateDropIndex]);

  const onPanelDragEnd = useCallback(() => {
    if (dragPanelId) suppressToggleClick.current = true;
    setDragPanelId(null);
    updateDropIndex(null);
  }, [dragPanelId, updateDropIndex]);

  const maxBodyFor = useCallback(
    (panelId: string, peerId?: string) => {
      const root = rootRef.current;
      if (!root) return 800;
      const collapsedCount = orderedPanels.filter(p => layout.open[p.id] === false).length;
      // Gaps between panels: sash when the upper panel is open, else a small spacer.
      const betweenSashes = orderedPanels.filter(
        (p, i) => layout.open[p.id] !== false && i < orderedPanels.length - 1,
      ).length;
      const spacerCount = Math.max(0, orderedPanels.length - 1 - betweenSashes);
      const last = orderedPanels[orderedPanels.length - 1];
      const bottomSash = last && layout.open[last.id] !== false ? 1 : 0;
      let available =
        root.clientHeight
        - collapsedCount * HEADER_H
        - (betweenSashes + bottomSash) * SASH_H
        - spacerCount * 6;

      // Other open panels keep their current body when this one grows into slack.
      for (const p of orderedPanels) {
        if (p.id === panelId || p.id === peerId) continue;
        if (layout.open[p.id] === false) continue;
        const h = layout.heights[p.id] ?? defaultHeightFor(p);
        available -= HEADER_H + Math.max(MIN_BODY, h);
      }

      // Leave room for the peer panel's minimum body when trading space.
      if (peerId && layout.open[peerId] !== false) {
        available -= HEADER_H + MIN_BODY;
      }
      // This panel's own header is inside its section height budget.
      return Math.max(MIN_BODY, available - HEADER_H);
    },
    [layout.open, layout.heights, orderedPanels],
  );

  const startSash = useCallback(
    (aboveId: string, belowId: string | null, e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const aboveEl = sectionRefs.current[aboveId];
      // Measure the live height so the first pointermove doesn't jump.
      const startAboveBody = aboveEl
        ? Math.max(MIN_BODY, aboveEl.getBoundingClientRect().height - HEADER_H)
        : layout.heights[aboveId] ?? DEFAULT_NORMAL;

      const belowOpen = belowId != null && layout.open[belowId] !== false;
      const belowEl = belowId ? sectionRefs.current[belowId] : null;
      const startBelowBody = belowOpen && belowEl
        ? Math.max(MIN_BODY, belowEl.getBoundingClientRect().height - HEADER_H)
        : belowId
          ? layout.heights[belowId] ?? DEFAULT_NORMAL
          : 0;

      const startY = e.clientY;
      const maxAbove = maxBodyFor(aboveId, belowOpen ? belowId ?? undefined : undefined);
      const sashKey = `${aboveId}:${belowId ?? "slack"}`;

      const target = e.currentTarget as HTMLElement;
      target.setPointerCapture(e.pointerId);
      setDraggingSash(sashKey);
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";

      // Sync stored height to the measured one immediately — kills the hiccup
      // where flex-expanded residue disagreed with the saved weight/height.
      setLayout(prev => ({
        ...prev,
        heights: {
          ...prev.heights,
          [aboveId]: Math.round(startAboveBody),
          ...(belowOpen && belowId
            ? { [belowId]: Math.round(startBelowBody) }
            : {}),
        },
      }));

      const onMove = (ev: PointerEvent) => {
        const delta = ev.clientY - startY;

        if (belowOpen && belowId) {
          const pair = startAboveBody + startBelowBody;
          const nextAbove = Math.min(
            pair - MIN_BODY,
            Math.max(MIN_BODY, startAboveBody + delta),
          );
          const nextBelow = pair - nextAbove;
          setLayout(prev => ({
            ...prev,
            heights: {
              ...prev.heights,
              [aboveId]: Math.round(nextAbove),
              [belowId]: Math.round(nextBelow),
            },
          }));
          return;
        }

        // Against collapsed pills / empty space — only the open panel moves.
        const nextAbove = Math.min(maxAbove, Math.max(MIN_BODY, startAboveBody + delta));
        setLayout(prev => ({
          ...prev,
          heights: { ...prev.heights, [aboveId]: Math.round(nextAbove) },
        }));
      };

      const onUp = (ev: PointerEvent) => {
        target.releasePointerCapture(ev.pointerId);
        target.removeEventListener("pointermove", onMove);
        target.removeEventListener("pointerup", onUp);
        target.removeEventListener("pointercancel", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        setDraggingSash(null);
      };

      target.addEventListener("pointermove", onMove);
      target.addEventListener("pointerup", onUp);
      target.addEventListener("pointercancel", onUp);
    },
    [layout.heights, layout.open, maxBodyFor],
  );

  if (orderedPanels.length === 0) return null;

  const reordering = dragPanelId != null;

  return (
    <div
      ref={rootRef}
      className="flex flex-col h-full min-h-0 gap-0 overflow-y-auto overflow-x-hidden"
      aria-label="Insights sections. Drag a section header to reorder."
    >
      {orderedPanels.map((panel, index) => {
        const isOpen = layout.open[panel.id] !== false;
        const bodyH = layout.heights[panel.id] ?? defaultHeightFor(panel);
        const next = orderedPanels[index + 1];
        const nextOpen = next ? layout.open[next.id] !== false : false;
        const showSash = Boolean(isOpen && next);
        const dragging = dragPanelId === panel.id;
        const showLineBefore = reordering && dropIndex === index;

        return (
          <div key={panel.id} className="contents">
            {/* Drop gap above each section — taller while dragging so the line sits “between” */}
            <div
              className={cn(
                "relative shrink-0 transition-[height] duration-100",
                reordering ? "h-3" : "h-0",
              )}
              onDragOver={e => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                updateDropIndex(index);
              }}
              onDrop={commitDrop}
            >
              {showLineBefore && <InsertLine />}
            </div>

            <section
              ref={el => {
                sectionRefs.current[panel.id] = el;
              }}
              onDragOver={e => {
                const el = sectionRefs.current[panel.id];
                if (el) setDropFromRow(index, e, el);
              }}
              onDrop={commitDrop}
              className={cn(
                "relative flex flex-col min-h-0 rounded-xl border border-[var(--border-strong)] bg-card overflow-hidden shrink-0 shadow-[var(--shadow-sm)]",
                dragging && "opacity-40",
              )}
              style={
                isOpen
                  ? {
                      height: HEADER_H + bodyH,
                      flexGrow: 0,
                      flexShrink: 0,
                    }
                  : {
                      height: HEADER_H,
                      flexGrow: 0,
                      flexShrink: 0,
                    }
              }
            >
              <div className="relative shrink-0">
                <button
                  type="button"
                  draggable
                  title="Drag to reorder · click to expand or collapse"
                  onDragStart={e => onPanelDragStart(panel.id, e)}
                  onDragEnd={onPanelDragEnd}
                  onClick={() => {
                    if (suppressToggleClick.current) {
                      suppressToggleClick.current = false;
                      return;
                    }
                    toggle(panel.id);
                  }}
                  aria-expanded={isOpen}
                  className={cn(
                    "group/phdr flex w-full items-center gap-1 px-1.5 shrink-0 text-left cursor-grab active:cursor-grabbing",
                    "hover:bg-[var(--surface-hover)] transition-colors",
                    isOpen ? "border-b border-border bg-secondary/60" : "bg-card",
                  )}
                  style={{ height: HEADER_H }}
                >
                  <GripVertical
                    className="size-3.5 shrink-0 text-foreground/20 opacity-0 transition-opacity group-hover/phdr:opacity-80"
                    aria-hidden
                  />
                  <ChevronRight
                    className={cn(
                      "size-3.5 text-muted-foreground shrink-0 transition-transform duration-200",
                      isOpen && "rotate-90 text-[var(--primary-soft-foreground)]",
                    )}
                    aria-hidden
                  />
                  <span className="text-[0.6rem] uppercase tracking-[0.18em] text-[var(--text-secondary)] font-semibold truncate">
                    {panel.label}
                  </span>
                </button>
                {panel.headerAction ? (
                  <div className="absolute inset-y-0 right-1.5 flex items-center" style={{ height: HEADER_H }}>
                    {panel.headerAction}
                  </div>
                ) : null}
              </div>

              {isOpen && (
                <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain px-3 py-2.5 pr-1.5 text-sm text-foreground [scrollbar-gutter:stable]">
                  {panel.children}
                </div>
              )}
            </section>

            {showSash && next && !reordering && (
              <PanelResizeHandle
                label={
                  nextOpen
                    ? `Resize between ${panel.label} and ${next.label}`
                    : `Resize ${panel.label}`
                }
                active={
                  draggingSash === `${panel.id}:${next.id}`
                  || draggingSash === `${panel.id}:slack`
                }
                onPointerDown={e =>
                  startSash(panel.id, nextOpen ? next.id : null, e)
                }
              />
            )}

            {/* Bottom slack sash — last module can grow into empty rail space */}
            {isOpen && !next && !reordering && (
              <PanelResizeHandle
                label={`Resize ${panel.label}`}
                active={draggingSash === `${panel.id}:slack`}
                onPointerDown={e => startSash(panel.id, null, e)}
              />
            )}

            {next && !showSash && !reordering && (
              <div className="h-1.5 shrink-0" aria-hidden />
            )}
          </div>
        );
      })}

      {/* Final drop gap — line after the last section */}
      <div
        className={cn(
          "relative shrink-0 transition-[height] duration-100",
          reordering ? "h-4" : "h-0",
        )}
        onDragOver={e => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          updateDropIndex(orderedPanels.length);
        }}
        onDrop={commitDrop}
      >
        {reordering && dropIndex === orderedPanels.length && <InsertLine />}
      </div>

      {/* Leftover space under fixed-height panels — also a drop target for “move to end” */}
      <div
        aria-hidden
        className="flex-1 min-h-0"
        onDragOver={e => {
          if (!reordering) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          updateDropIndex(orderedPanels.length);
        }}
        onDrop={commitDrop}
      />
    </div>
  );
}

/** Bright insert marker — sits between sections, not “inside” a card. */
function InsertLine() {
  return (
    <div
      role="presentation"
      className="pointer-events-none absolute inset-x-0 top-1/2 z-30 flex -translate-y-1/2 items-center gap-1.5 px-0.5"
    >
      <span
        aria-hidden
        className="size-2 shrink-0 rounded-full bg-indigo-400 shadow-[0_0_10px_rgba(129,140,248,0.95)]"
      />
      <span
        aria-hidden
        className="h-[3px] flex-1 rounded-full bg-indigo-400 shadow-[0_0_12px_rgba(129,140,248,0.85)]"
      />
      <span
        aria-hidden
        className="size-2 shrink-0 rounded-full bg-indigo-400 shadow-[0_0_10px_rgba(129,140,248,0.95)]"
      />
    </div>
  );
}

/** Sensible default body heights for Insights modules. */
export const INTEL_HEIGHT = {
  /** Blurb + one control + one metric row (e.g. Compare vs). */
  snug: 140,
  normal: DEFAULT_NORMAL,
  /** Shared height for sections that are often open together. */
  paired: 360,
  tall: 320,
  /**
   * Models routing + inline picker. The tier list is short; the open picker (search, provider
   * buttons and a scrolling list) needs the height, so this stays tall.
   */
  routing: 760,
  /** Cost total: workspace + range chips + metric + CTA — no inner scroll. */
  costTotal: 248,
} as const;
