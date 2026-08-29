/**
 * Persist sidebar workspace list order (browser-local).
 * Dynamic ids — new workspaces append; removed ids drop out.
 */

import { useCallback, useEffect, useState } from "react";

export const WORKSPACE_LIST_ORDER_KEY = "sm_workspace_list_order";

export function normalizeIdOrder(saved: unknown, ids: string[]): string[] {
  const idSet = new Set(ids);
  const ordered: string[] = [];
  if (Array.isArray(saved)) {
    for (const id of saved) {
      if (typeof id === "string" && idSet.has(id) && !ordered.includes(id)) {
        ordered.push(id);
      }
    }
  }
  for (const id of ids) {
    if (!ordered.includes(id)) ordered.push(id);
  }
  return ordered;
}

export function reorderIds(
  order: string[],
  sourceId: string,
  insertBefore: number,
): string[] {
  const from = order.indexOf(sourceId);
  if (from < 0) return order;
  let to = Math.max(0, Math.min(insertBefore, order.length));
  if (from < to) to -= 1;
  if (to === from) return order;
  const next = order.filter(id => id !== sourceId);
  next.splice(to, 0, sourceId);
  return next;
}

function loadRaw(): unknown {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(WORKSPACE_LIST_ORDER_KEY);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}

function saveOrder(order: string[]): void {
  try {
    localStorage.setItem(WORKSPACE_LIST_ORDER_KEY, JSON.stringify(order));
  } catch {
    /* quota */
  }
}

/** Keep order in sync with the live workspace id set. */
export function useWorkspaceListOrder(workspaceIds: string[]): [
  string[],
  (next: string[]) => void,
] {
  const idsKey = workspaceIds.join("|");
  const [order, setOrderState] = useState<string[]>(() => [...workspaceIds]);

  useEffect(() => {
    const ids = idsKey ? idsKey.split("|") : [];
    setOrderState(normalizeIdOrder(loadRaw(), ids));
  }, [idsKey]);

  const setOrder = useCallback(
    (next: string[]) => {
      const ids = idsKey ? idsKey.split("|") : [];
      const normalized = normalizeIdOrder(next, ids);
      setOrderState(normalized);
      saveOrder(normalized);
    },
    [idsKey],
  );

  return [order, setOrder];
}
