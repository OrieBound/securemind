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
  },
) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const asUser = opts.asUser ?? null;
  const prevUser = useRef<string | null>(asUser);

  useEffect(() => {
    const ac = new AbortController();
    if (prevUser.current !== asUser) {
      setData(null);
      prevUser.current = asUser;
    }
    setLoading(true);
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
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [path, opts.range, opts.workspaceId, asUser, nonce]);

  const retry = useCallback(() => setNonce(n => n + 1), []);
  return { data, loading, error, retry };
}
