"use client";

/**
 * Per-workspace feature list (Chat, Knowledge, Memory, Bookmarks, Workspace).
 * Order is per-browser. Drag with insert-line feedback (same pattern as Insights).
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type DragEvent,
  type SVGProps,
} from "react";
import {
  Bookmark,
  Brain,
  FileText,
  GripVertical,
  MessageSquare,
  Pencil,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type WorkspaceFeatureId =
  | "thread"
  | "documents"
  | "memory"
  | "bookmarks"
  | "workspace-settings";

export const WORKSPACE_FEATURE_ORDER_KEY = "sm_workspace_feature_order";

export const DEFAULT_WORKSPACE_FEATURE_ORDER: WorkspaceFeatureId[] = [
  "thread",
  "documents",
  "memory",
  "bookmarks",
  "workspace-settings",
];

type LucideIcon = ComponentType<SVGProps<SVGSVGElement> & { className?: string }>;

export type WorkspaceFeatureDef = {
  id: WorkspaceFeatureId;
  label: string;
  icon: LucideIcon;
  iconWrap: string;
  iconColor: string;
};

export const WORKSPACE_FEATURES: Record<WorkspaceFeatureId, WorkspaceFeatureDef> = {
  thread: {
    id: "thread",
    label: "Chat",
    icon: MessageSquare,
    iconWrap: "bg-indigo-500/20 border-indigo-500/25",
    iconColor: "text-indigo-300",
  },
  documents: {
    id: "documents",
    label: "Knowledge",
    icon: FileText,
    iconWrap: "bg-emerald-500/20 border-emerald-500/25",
    iconColor: "text-emerald-300",
  },
  memory: {
    id: "memory",
    label: "Memory",
    icon: Brain,
    iconWrap: "bg-violet-500/20 border-violet-500/25",
    iconColor: "text-violet-300",
  },
  bookmarks: {
    id: "bookmarks",
    label: "Bookmarks",
    icon: Bookmark,
    iconWrap: "bg-amber-500/20 border-amber-500/25",
    iconColor: "text-amber-300",
  },
  "workspace-settings": {
    id: "workspace-settings",
    label: "Workspace",
    icon: Pencil,
    iconWrap: "bg-[var(--primary-soft)] border-[var(--primary-border)] dark:bg-slate-500/20 dark:border-slate-500/25",
    iconColor: "text-[var(--primary-soft-foreground)] dark:text-slate-300",
  },
};

function isFeatureId(v: unknown): v is WorkspaceFeatureId {
  return typeof v === "string" && v in WORKSPACE_FEATURES;
}

export function normalizeWorkspaceFeatureOrder(raw: unknown): WorkspaceFeatureId[] {
  if (!Array.isArray(raw)) return [...DEFAULT_WORKSPACE_FEATURE_ORDER];
  const seen = new Set<WorkspaceFeatureId>();
  const ordered: WorkspaceFeatureId[] = [];
  for (const item of raw) {
    if (isFeatureId(item) && !seen.has(item)) {
      seen.add(item);
      ordered.push(item);
    }
  }
  for (const id of DEFAULT_WORKSPACE_FEATURE_ORDER) {
    if (!seen.has(id)) ordered.push(id);
  }
  return ordered;
}

export function reorderWorkspaceFeature(
  order: WorkspaceFeatureId[],
  sourceId: WorkspaceFeatureId,
  insertBefore: number,
): WorkspaceFeatureId[] {
  const from = order.indexOf(sourceId);
  if (from < 0) return order;
  let to = Math.max(0, Math.min(insertBefore, order.length));
  if (from < to) to -= 1;
  if (to === from) return order;
  const next = order.filter(id => id !== sourceId);
  next.splice(to, 0, sourceId);
  return next;
}

function loadOrder(): WorkspaceFeatureId[] {
  if (typeof window === "undefined") return [...DEFAULT_WORKSPACE_FEATURE_ORDER];
  try {
    const raw = localStorage.getItem(WORKSPACE_FEATURE_ORDER_KEY);
    if (!raw) return [...DEFAULT_WORKSPACE_FEATURE_ORDER];
    return normalizeWorkspaceFeatureOrder(JSON.parse(raw) as unknown);
  } catch {
    return [...DEFAULT_WORKSPACE_FEATURE_ORDER];
  }
}

function saveOrder(order: WorkspaceFeatureId[]): void {
  try {
    localStorage.setItem(WORKSPACE_FEATURE_ORDER_KEY, JSON.stringify(order));
  } catch {
    /* quota */
  }
}

export function useWorkspaceFeatureOrder(): [
  WorkspaceFeatureId[],
  (next: WorkspaceFeatureId[]) => void,
] {
  const [order, setOrderState] = useState<WorkspaceFeatureId[]>(
    () => [...DEFAULT_WORKSPACE_FEATURE_ORDER],
  );

  useEffect(() => {
    setOrderState(loadOrder());
  }, []);

  const setOrder = useCallback((next: WorkspaceFeatureId[]) => {
    const normalized = normalizeWorkspaceFeatureOrder(next);
    setOrderState(normalized);
    saveOrder(normalized);
  }, []);

  return [order, setOrder];
}

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

export function WorkspaceFeatureNav({
  order,
  onReorder,
  activeId,
  onSelect,
  badgeFor,
}: {
  order: WorkspaceFeatureId[];
  onReorder: (next: WorkspaceFeatureId[]) => void;
  activeId: string | null;
  onSelect: (id: WorkspaceFeatureId) => void;
  /** Optional badge count per feature (e.g. unseen Bookmarks). */
  badgeFor?: (id: WorkspaceFeatureId) => number;
}) {
  const [dragId, setDragId] = useState<WorkspaceFeatureId | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const dropIndexRef = useRef<number | null>(null);
  const suppressClick = useRef(false);
  const rowRefs = useRef<Record<string, HTMLElement | null>>({});

  const updateDropIndex = useCallback((next: number | null) => {
    dropIndexRef.current = next;
    setDropIndex(prev => (prev === next ? prev : next));
  }, []);

  const onDragStart = useCallback((id: WorkspaceFeatureId, e: DragEvent) => {
    setDragId(id);
    updateDropIndex(null);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
  }, [updateDropIndex]);

  const setDropFromRow = useCallback((rowIndex: number, e: DragEvent, el: HTMLElement) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const rect = el.getBoundingClientRect();
    const ratio = rect.height > 0 ? (e.clientY - rect.top) / rect.height : 1;
    updateDropIndex(ratio < 0.35 ? rowIndex : rowIndex + 1);
  }, [updateDropIndex]);

  const commitDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData("text/plain");
    const source =
      dragId
      ?? (isFeatureId(raw) ? raw : null);
    const at = dropIndexRef.current;
    setDragId(null);
    updateDropIndex(null);
    if (!source || at == null) return;
    suppressClick.current = true;
    onReorder(reorderWorkspaceFeature(order, source, at));
  }, [dragId, onReorder, order, updateDropIndex]);

  const onDragEnd = useCallback(() => {
    if (dragId) suppressClick.current = true;
    setDragId(null);
    updateDropIndex(null);
  }, [dragId, updateDropIndex]);

  const reordering = dragId != null;

  return (
    <nav
      aria-label="Workspace features. Drag to reorder."
      data-tour="features"
      className="flex flex-col"
    >
      {order.map((id, index) => {
        const item = WORKSPACE_FEATURES[id];
        const Icon = item.icon;
        const isNavActive = activeId === id;
        const badge = badgeFor?.(id) ?? 0;
        const dragging = dragId === id;
        const showLineBefore = reordering && dropIndex === index;

        return (
          <div key={id} className="contents">
            <div
              className={cn(
                "relative shrink-0 transition-[height] duration-100",
                reordering ? "h-2.5" : "h-0",
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

            <button
              type="button"
              draggable
              title="Drag to reorder · click to open"
              ref={el => {
                rowRefs.current[id] = el;
              }}
              onDragStart={e => onDragStart(id, e)}
              onDragOver={e => {
                const el = rowRefs.current[id] ?? (e.currentTarget as HTMLElement);
                setDropFromRow(index, e, el);
              }}
              onDrop={commitDrop}
              onDragEnd={onDragEnd}
              onClick={() => {
                if (suppressClick.current) {
                  suppressClick.current = false;
                  return;
                }
                onSelect(id);
              }}
              className={cn(
                "group/feat relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-all cursor-grab active:cursor-grabbing",
                isNavActive
                  ? "bg-[var(--surface-selected)] text-[var(--primary-soft-foreground)] shadow-[inset_0_0_0_1px_var(--primary-border)] dark:bg-foreground/[0.09] dark:text-foreground/90 dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]"
                  : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-foreground dark:text-foreground/42 dark:hover:bg-foreground/[0.05] dark:hover:text-foreground/72",
                dragging && "opacity-40",
              )}
            >
              <span className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-lg border transition-colors",
                isNavActive
                  ? item.iconWrap
                  : "bg-secondary border-border group-hover/feat:bg-[var(--surface-hover)] dark:bg-foreground/[0.04] dark:border-foreground/[0.06] dark:group-hover/feat:bg-foreground/[0.07]",
              )}>
                <Icon className={cn(
                  "size-3.5",
                  isNavActive
                    ? item.iconColor
                    : "text-muted-foreground group-hover/feat:text-foreground dark:text-foreground/38 dark:group-hover/feat:text-foreground/58",
                )} aria-hidden />
              </span>
              <span className={cn(
                "flex-1 min-w-0 text-[length:var(--font-size-ui)] leading-[var(--leading-ui)]",
                isNavActive ? "font-medium" : "font-normal",
              )}>{item.label}</span>
              {badge > 0 && (
                <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-primary text-[0.55rem] font-bold text-primary-foreground">
                  {badge > 99 ? "99+" : badge}
                </span>
              )}
              <GripVertical
                aria-hidden
                className="size-3.5 shrink-0 text-foreground/20 opacity-0 transition-opacity group-hover/feat:opacity-80"
              />
            </button>
          </div>
        );
      })}

      <div
        className={cn(
          "relative shrink-0 transition-[height] duration-100",
          reordering ? "h-3" : "h-0",
        )}
        onDragOver={e => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          updateDropIndex(order.length);
        }}
        onDrop={commitDrop}
      >
        {reordering && dropIndex === order.length && <InsertLine />}
      </div>
    </nav>
  );
}
