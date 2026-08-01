"use client";

import { cn } from "@/lib/utils";

export function TraitSlider({
  label,
  left,
  right,
  value,
  onChange,
}: {
  label: string;
  left: string;
  right: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-3">
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <span className="text-sm font-medium text-white/75">{label}</span>
        <span className="text-[0.62rem] font-mono tabular-nums text-violet-300/70">{value}</span>
      </div>
      <div className="flex items-center gap-2.5">
        <span className="text-[0.62rem] text-white/28 w-16 shrink-0 text-right">{left}</span>
        <input
          type="range"
          min={0}
          max={100}
          value={value}
          onChange={e => onChange(Number(e.target.value))}
          className={cn(
            "flex-1 h-1.5 appearance-none rounded-full cursor-pointer",
            "bg-white/[0.08] accent-violet-500",
            "[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:size-3.5",
            "[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-violet-400",
            "[&::-webkit-slider-thumb]:shadow-[0_0_8px_rgba(167,139,250,0.5)]",
          )}
          aria-label={`${label}: ${value}`}
        />
        <span className="text-[0.62rem] text-white/28 w-16 shrink-0">{right}</span>
      </div>
    </div>
  );
}
