"use client";

type Props = {
  label: string;
  value: string;
  hint?: string;
};

export function KpiCard({ label, value, hint }: Props) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-3 min-w-0">
      <p className="text-[0.65rem] uppercase tracking-wide text-white/40 font-medium truncate">
        {label}
      </p>
      <p className="text-xl font-semibold text-white/90 mt-1 tabular-nums truncate">{value}</p>
      {hint && <p className="text-[0.65rem] text-white/30 mt-1">{hint}</p>}
    </div>
  );
}
