"use client";

import { cn } from "@/lib/utils";
import type { RadarAxis } from "@/lib/memory/personality";

const SIZE = 280;
const CENTER = SIZE / 2;
const RADIUS = 100;

function polar(index: number, total: number, r: number): { x: number; y: number } {
  const angle = (Math.PI * 2 * index) / total - Math.PI / 2;
  return {
    x: CENTER + r * Math.cos(angle),
    y: CENTER + r * Math.sin(angle),
  };
}

function polygonPoints(values: number[], max = 100): string {
  return values
    .map((v, i) => {
      const r = (v / max) * RADIUS;
      const { x, y } = polar(i, values.length, r);
      return `${x},${y}`;
    })
    .join(" ");
}

export function PersonalityRadar({
  axes,
  className,
}: {
  axes: RadarAxis[];
  className?: string;
}) {
  if (axes.length < 3) {
    return (
      <div className={cn("flex items-center justify-center h-[280px] text-sm text-white/30", className)}>
        Not enough data for chart yet.
      </div>
    );
  }

  const values = axes.map(a => a.value);
  const gridLevels = [25, 50, 75, 100];

  return (
    <div className={cn("relative", className)}>
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="w-full max-w-[320px] mx-auto"
        role="img"
        aria-label="Personality radar chart"
      >
        {gridLevels.map(level => (
          <polygon
            key={level}
            points={polygonPoints(axes.map(() => level))}
            fill="none"
            stroke="rgba(255,255,255,0.06)"
            strokeWidth={1}
          />
        ))}

        {axes.map((a, i) => {
          const outer = polar(i, axes.length, RADIUS);
          const label = polar(i, axes.length, RADIUS + 22);
          return (
            <g key={a.axis}>
              <line
                x1={CENTER}
                y1={CENTER}
                x2={outer.x}
                y2={outer.y}
                stroke="rgba(255,255,255,0.08)"
                strokeWidth={1}
              />
              <text
                x={label.x}
                y={label.y}
                textAnchor="middle"
                dominantBaseline="middle"
                className="fill-white/45 text-[9px] font-medium uppercase tracking-wide"
              >
                {a.axis}
              </text>
            </g>
          );
        })}

        <polygon
          points={polygonPoints(values)}
          fill="rgba(139, 92, 246, 0.25)"
          stroke="rgba(167, 139, 250, 0.85)"
          strokeWidth={2}
        />

        {values.map((v, i) => {
          const { x, y } = polar(i, axes.length, (v / 100) * RADIUS);
          return (
            <circle
              key={i}
              cx={x}
              cy={y}
              r={3.5}
              fill="rgb(167, 139, 250)"
              stroke="rgb(30, 27, 75)"
              strokeWidth={1.5}
            />
          );
        })}
      </svg>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 mt-3 px-1">
        {axes.map(a => (
          <div key={a.axis} className="flex items-center justify-between gap-2 text-[0.65rem]">
            <span className="text-white/35">{a.axis}</span>
            <span className="text-violet-300/80 font-mono tabular-nums">{a.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function TraitBar({
  label,
  score,
  level,
  evidence,
}: {
  label: string;
  score: number;
  level: string;
  evidence: string[];
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3.5 py-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-sm font-medium text-white/75">{label}</span>
        <span className="text-[0.62rem] uppercase tracking-wider text-violet-300/70 font-semibold">{level}</span>
      </div>
      <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden mb-2">
        <div
          className="h-full rounded-full bg-gradient-to-r from-violet-600/80 to-indigo-400/80 transition-all duration-500"
          style={{ width: `${score}%` }}
        />
      </div>
      {evidence[0] && (
        <p className="text-[0.68rem] text-white/30 leading-relaxed">{evidence[0]}</p>
      )}
    </div>
  );
}
