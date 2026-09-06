"use client";

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import type { EditableRateRow } from "@/lib/pricing/rate-overrides";

type PricingPayload = {
  rates: EditableRateRow[];
  overrideCount: number;
  canEdit: boolean;
  pricing: { version: string; effective: string };
};

export function RateTableEditor() {
  const [payload, setPayload] = useState<PricingPayload | null>(null);
  const [rows, setRows] = useState<EditableRateRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/settings/pricing", { credentials: "same-origin" });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `Could not load rates (${res.status})`);
    }
    const data = (await res.json()) as PricingPayload;
    setPayload(data);
    setRows(data.rates);
  }, []);

  useEffect(() => {
    void load().catch(err => {
      setError(err instanceof Error ? err.message : "Could not load rates");
    });
  }, [load]);

  async function save(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/settings/pricing", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as PricingPayload & { error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? `Save failed (${res.status})`);
      }
      setPayload(data);
      setRows(data.rates);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  function updateRow(index: number, field: "inputPerM" | "outputPerM", raw: string) {
    const value = Number(raw);
    setRows(current =>
      current.map((row, i) => (i === index ? { ...row, [field]: value } : row)),
    );
    setSaved(false);
  }

  if (!payload) {
    return error ? (
      <p className="text-sm text-destructive">{error}</p>
    ) : (
      <p className="text-sm text-muted-foreground">Loading list rates…</p>
    );
  }

  const bedrock = rows.map((row, i) => ({ row, i })).filter(x => x.row.provider === "bedrock");
  const groq = rows.map((row, i) => ({ row, i })).filter(x => x.row.provider === "groq");
  const canEdit = payload.canEdit;

  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3 space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">List rates used for estimates</h3>
        <p className="text-[0.65rem] text-muted-foreground">
          Bundle {payload.pricing.version} (effective {payload.pricing.effective})
          {payload.overrideCount > 0 ? ` · ${payload.overrideCount} override(s)` : ""}
        </p>
      </div>
      <p className="text-[0.7rem] text-muted-foreground">
        USD per million tokens. These are published on-demand list rates, not your invoice.
        Saving here updates estimates for new chat turns only — local Ollama stays $0.
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {saved && <p className="text-[0.7rem] text-emerald-300/80">Rates saved for new turns.</p>}

      <RateGroup title="Amazon Bedrock" entries={bedrock} canEdit={canEdit} onChange={updateRow} />
      <RateGroup title="Groq" entries={groq} canEdit={canEdit} onChange={updateRow} />

      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void save({ rates: rows })}
            className="rounded-lg border border-border bg-secondary px-3 py-1.5 text-xs text-foreground hover:bg-secondary/80 disabled:opacity-50 cursor-pointer"
          >
            {busy ? "Saving…" : "Save rates"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void save({ reset: true })}
            className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary/80 disabled:opacity-50 cursor-pointer"
          >
            Reset to published list
          </button>
        </div>
      )}
    </div>
  );
}

function RateGroup({
  title,
  entries,
  canEdit,
  onChange,
}: {
  title: string;
  entries: { row: EditableRateRow; i: number }[];
  canEdit: boolean;
  onChange: (index: number, field: "inputPerM" | "outputPerM", raw: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <h4 className="text-[0.7rem] uppercase tracking-wide text-muted-foreground">{title}</h4>
      <div className="overflow-x-auto">
        <table className="w-full text-[0.7rem]">
          <thead>
            <tr className="text-muted-foreground text-left">
              <th className="font-medium py-1 pr-2">Model</th>
              <th className="font-medium py-1 pr-2 w-24">Input $/M</th>
              <th className="font-medium py-1 pr-2 w-24">Output $/M</th>
              <th className="font-medium py-1 w-20">Source</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(({ row, i }) => (
              <tr key={`${row.provider}:${row.model}`} className="border-t border-border/60">
                <td className="py-1 pr-2 font-mono text-[0.65rem] text-foreground/80">
                  {row.model}
                </td>
                <td className="py-1 pr-2">
                  <RateInput
                    value={row.inputPerM}
                    disabled={!canEdit}
                    onChange={raw => onChange(i, "inputPerM", raw)}
                  />
                </td>
                <td className="py-1 pr-2">
                  <RateInput
                    value={row.outputPerM}
                    disabled={!canEdit}
                    onChange={raw => onChange(i, "outputPerM", raw)}
                  />
                </td>
                <td className={cn("py-1", row.source === "override" ? "text-amber-200/80" : "text-muted-foreground")}>
                  {row.source === "override" ? "Override" : "List"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RateInput({
  value,
  disabled,
  onChange,
}: {
  value: number;
  disabled: boolean;
  onChange: (raw: string) => void;
}) {
  return (
    <input
      type="number"
      min={0}
      max={10000}
      step="0.001"
      value={Number.isFinite(value) ? value : 0}
      disabled={disabled}
      onChange={e => onChange(e.target.value)}
      className="w-24 rounded-md border border-border bg-background px-1.5 py-1 text-[0.7rem] tabular-nums disabled:opacity-60"
    />
  );
}
