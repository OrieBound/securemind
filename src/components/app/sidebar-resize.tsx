"use client";

/**
 * Drag-to-resize for the left workspaces rail and the right Insights rail.
 * Widths persist in localStorage so a preferred layout survives reloads.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export const LEFT_SIDEBAR_KEY = "sm_left_sidebar_w";
export const RIGHT_SIDEBAR_KEY = "sm_right_sidebar_w_v4";
/** Height of the Settings section stack above the bottom Settings toggle. */
export const SETTINGS_NAV_HEIGHT_KEY = "sm_settings_nav_h_v2";

export const LEFT_SIDEBAR_DEFAULT = 288;  // w-72
export const RIGHT_SIDEBAR_DEFAULT = 421; // ~5% narrower than prior 443
export const LEFT_SIDEBAR_MIN = 220;
export const LEFT_SIDEBAR_MAX = 520;
export const RIGHT_SIDEBAR_MIN = 280;
export const RIGHT_SIDEBAR_MAX = 720;
/** Tall enough for Overview + AI + Insights + Preferences + Admin without scrolling. */
export const SETTINGS_NAV_HEIGHT_DEFAULT = 520;
export const SETTINGS_NAV_HEIGHT_MIN = 160;
export const SETTINGS_NAV_HEIGHT_MAX = 720;

function readStoredWidth(key: string, fallback: number, min: number, max: number): number {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
  } catch {
    return fallback;
  }
}

export function useSidebarWidth(
  key: string,
  fallback: number,
  min: number,
  max: number,
) {
  const [width, setWidth] = useState(fallback);
  const [dragging, setDragging] = useState(false);
  const ready = useRef(false);

  useEffect(() => {
    setWidth(readStoredWidth(key, fallback, min, max));
    ready.current = true;
  }, [key, fallback, min, max]);

  useEffect(() => {
    if (!ready.current || dragging) return;
    try {
      localStorage.setItem(key, String(width));
    } catch {
      /* quota / private browsing */
    }
  }, [key, width, dragging]);

  const startResize = useCallback(
    (edge: "left" | "right", e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startW = width;
      const target = e.currentTarget as HTMLElement;
      target.setPointerCapture(e.pointerId);
      setDragging(true);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const onMove = (ev: PointerEvent) => {
        const delta = edge === "right" ? ev.clientX - startX : startX - ev.clientX;
        const next = Math.min(max, Math.max(min, Math.round(startW + delta)));
        setWidth(next);
      };
      const onUp = (ev: PointerEvent) => {
        target.releasePointerCapture(ev.pointerId);
        target.removeEventListener("pointermove", onMove);
        target.removeEventListener("pointerup", onUp);
        target.removeEventListener("pointercancel", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        setDragging(false);
      };
      target.addEventListener("pointermove", onMove);
      target.addEventListener("pointerup", onUp);
      target.addEventListener("pointercancel", onUp);
    },
    [width, min, max],
  );

  return { width, setWidth, dragging, startResize };
}

/** Vertical counterpart of useSidebarWidth — persists panel height in localStorage. */
export function useResizableHeight(
  key: string,
  fallback: number,
  min: number,
  max: number,
) {
  const [height, setHeight] = useState(fallback);
  const [dragging, setDragging] = useState(false);
  const ready = useRef(false);

  useEffect(() => {
    setHeight(readStoredWidth(key, fallback, min, max));
    ready.current = true;
  }, [key, fallback, min, max]);

  useEffect(() => {
    if (!ready.current || dragging) return;
    try {
      localStorage.setItem(key, String(height));
    } catch {
      /* quota / private browsing */
    }
  }, [key, height, dragging]);

  const startResize = useCallback(
    (edge: "top" | "bottom", e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startY = e.clientY;
      const startH = height;
      const target = e.currentTarget as HTMLElement;
      target.setPointerCapture(e.pointerId);
      setDragging(true);
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";

      const onMove = (ev: PointerEvent) => {
        // Dragging the top edge upward grows the panel; bottom edge downward grows it.
        const delta = edge === "top" ? startY - ev.clientY : ev.clientY - startY;
        const next = Math.min(max, Math.max(min, Math.round(startH + delta)));
        setHeight(next);
      };
      const onUp = (ev: PointerEvent) => {
        target.releasePointerCapture(ev.pointerId);
        target.removeEventListener("pointermove", onMove);
        target.removeEventListener("pointerup", onUp);
        target.removeEventListener("pointercancel", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        setDragging(false);
      };
      target.addEventListener("pointermove", onMove);
      target.addEventListener("pointerup", onUp);
      target.addEventListener("pointercancel", onUp);
    },
    [height, min, max],
  );

  return { height, setHeight, dragging, startResize };
}

/**
 * Wide, lenient grab zone along a sidebar edge.
 * Idle: nearly invisible. Hover/drag: soft indigo wash + bright center line.
 */
export function SidebarResizeHandle({
  edge,
  onPointerDown,
  active,
  className,
  label,
}: {
  edge: "left" | "right";
  onPointerDown: (e: React.PointerEvent) => void;
  active?: boolean;
  className?: string;
  label: string;
}) {
  // Gradient fans outward from the seam into the adjacent pane.
  const wash =
    edge === "right"
      ? "bg-gradient-to-r from-indigo-400/0 via-indigo-400/25 to-indigo-400/0"
      : "bg-gradient-to-l from-indigo-400/0 via-indigo-400/25 to-indigo-400/0";

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      title="Drag to resize"
      onPointerDown={onPointerDown}
      className={cn(
        "group/resize absolute top-0 bottom-0 z-30 w-4 cursor-col-resize touch-none",
        "flex items-stretch justify-center",
        edge === "right" ? "right-0 translate-x-1/2" : "left-0 -translate-x-1/2",
        className,
      )}
    >
      {/* Soft full-height wash — only on hover / while dragging */}
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-y-0 inset-x-0 transition-opacity duration-150",
          wash,
          active
            ? "opacity-100"
            : "opacity-0 group-hover/resize:opacity-100",
        )}
      />

      {/* Center seam line */}
      <span
        aria-hidden
        className={cn(
          "pointer-events-none relative z-10 w-px self-stretch transition-all duration-150",
          active
            ? "bg-indigo-300/90 shadow-[0_0_10px_rgba(129,140,248,0.55)]"
            : "bg-foreground/10 group-hover/resize:bg-indigo-300/80 group-hover/resize:shadow-[0_0_8px_rgba(129,140,248,0.4)]",
        )}
      />

      {/* Short grip pill in the middle — the “you can grab this” cue */}
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute top-1/2 left-1/2 z-10 -translate-x-1/2 -translate-y-1/2",
          "h-10 w-1 rounded-full transition-all duration-150",
          active
            ? "bg-indigo-300/90 scale-y-110"
            : "bg-foreground/15 group-hover/resize:bg-indigo-300/85 group-hover/resize:scale-y-110",
        )}
      />
    </div>
  );
}

/**
 * Horizontal grab zone along a panel top/bottom edge (row-resize).
 * Same hover language as the vertical sidebar handles.
 */
export function PanelResizeHandle({
  edge,
  onPointerDown,
  active,
  className,
  label,
}: {
  edge: "top" | "bottom";
  onPointerDown: (e: React.PointerEvent) => void;
  active?: boolean;
  className?: string;
  label: string;
}) {
  const wash =
    edge === "top"
      ? "bg-gradient-to-b from-indigo-400/0 via-indigo-400/25 to-indigo-400/0"
      : "bg-gradient-to-t from-indigo-400/0 via-indigo-400/25 to-indigo-400/0";

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label={label}
      title="Drag to resize"
      onPointerDown={onPointerDown}
      className={cn(
        "group/resize absolute left-0 right-0 z-30 h-3 cursor-row-resize touch-none",
        "flex items-center justify-center",
        edge === "top" ? "top-0 -translate-y-1/2" : "bottom-0 translate-y-1/2",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0 transition-opacity duration-150",
          wash,
          active ? "opacity-100" : "opacity-0 group-hover/resize:opacity-100",
        )}
      />
      <span
        aria-hidden
        className={cn(
          "pointer-events-none relative z-10 h-px w-full transition-all duration-150",
          active
            ? "bg-indigo-300/90 shadow-[0_0_10px_rgba(129,140,248,0.55)]"
            : "bg-foreground/10 group-hover/resize:bg-indigo-300/80 group-hover/resize:shadow-[0_0_8px_rgba(129,140,248,0.4)]",
        )}
      />
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2",
          "h-1 w-10 rounded-full transition-all duration-150",
          active
            ? "bg-indigo-300/90 scale-x-110"
            : "bg-foreground/20 group-hover/resize:bg-indigo-300/85 group-hover/resize:scale-x-110",
        )}
      />
    </div>
  );
}
