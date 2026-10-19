"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchAnalyticsJson } from "@/lib/analytics/client";
import type { AnalyticsRange } from "@/lib/analytics/types";

export function useAnalyticsQuery<T>(
  path: "security" | "usage" | "cost",
  opts: {
    range: AnalyticsRange;
    workspaceId?: string | null;
    asUser?: string | null;
    /** Silent refetch interval while the view is open. */
    pollMs?: number;
  },
) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const asUser = opts.asUser ?? null;
  const pollMs = opts.pollMs ?? 0;
  const prevUser = useRef<string | null>(asUser);
  const silent = useRef(false);

  useEffect(() => {
    silent.current = false;
  }, [path, opts.range, opts.workspaceId, asUser]);

  useEffect(() => {
    const ac = new AbortController();
    if (prevUser.current !== asUser) {
      setData(null);
      prevUser.current = asUser;
    }
    if (!silent.current) setLoading(true);
    setError(null);
    fetchAnalyticsJson<T>(
      path,
      { range: opts.range, workspaceId: opts.workspaceId, asUser },
      ac.signal,
    )
      .then(d => {
        if (!ac.signal.aborted) setData(d);
      })
      .catch(e => {
        if (ac.signal.aborted || (e instanceof Error && e.name === "AbortError")) return;
        setError(e instanceof Error ? e.message : "Failed to load");
      })
      .finally(() => {
        if (!ac.signal.aborted) {
          setLoading(false);
          silent.current = true;
        }
      });
    return () => ac.abort();
  }, [path, opts.range, opts.workspaceId, asUser, nonce]);

  useEffect(() => {
    if (!pollMs || pollMs < 5000) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      setNonce(n => n + 1);
    }, pollMs);
    return () => window.clearInterval(id);
  }, [pollMs, path, opts.range, opts.workspaceId, asUser]);

  const retry = useCallback(() => {
    silent.current = false;
    setNonce(n => n + 1);
  }, []);
  return { data, loading, error, retry };
}
