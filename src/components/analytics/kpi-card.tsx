"use client";

type Props = {
  label: string;
  value: string;
  hint?: string;
};

export function KpiCard({ label, value, hint }: Props) {
  return (
    <div className="rounded-xl border border-border bg-card px-3.5 py-3 min-w-0 shadow-[var(--shadow-sm)]">
      <p className="text-[0.65rem] uppercase tracking-wide text-muted-foreground font-medium truncate">
        {label}
      </p>
      <p className="text-xl font-semibold text-foreground mt-1 tabular-nums truncate">{value}</p>
      {hint && <p className="text-[0.65rem] text-[var(--text-subtle)] mt-1">{hint}</p>}
    </div>
  );
}
