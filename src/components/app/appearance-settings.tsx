"use client";

import { Check, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/components/app/theme-provider";
import type { ThemePreference } from "@/lib/theme";

const OPTIONS: {
  id: ThemePreference;
  label: string;
  description: string;
  Preview: () => React.ReactNode;
}[] = [
  {
    id: "dark",
    label: "Dark",
    description: "Deep navy surfaces — the SecureMind default.",
    Preview: DarkPreview,
  },
  {
    id: "light",
    label: "Light",
    description: "Clean white surfaces with cool grey chrome — high contrast, light hierarchy.",
    Preview: LightPreview,
  },
];

function DarkPreview() {
  return (
    <div className="theme-preview-dark rounded-lg border border-white/10 p-2.5 h-[5.5rem] flex flex-col gap-1.5 overflow-hidden">
      <div className="flex items-center gap-1.5">
        <div className="size-2 rounded-full bg-indigo-400/80" />
        <div className="h-1.5 w-12 rounded-full bg-white/25" />
      </div>
      <div className="flex-1 rounded-md bg-white/[0.04] border border-white/8 p-1.5 space-y-1">
        <div className="h-1 w-3/4 rounded-full bg-white/20" />
        <div className="h-1 w-1/2 rounded-full bg-white/12" />
        <div className="mt-1 h-4 w-10 rounded bg-indigo-500/40" />
      </div>
    </div>
  );
}

function LightPreview() {
  return (
    <div className="theme-preview-light rounded-lg border border-[#D1D5DB] p-2.5 h-[5.5rem] flex flex-col gap-1.5 overflow-hidden shadow-sm">
      <div className="flex items-center gap-1.5">
        <div className="size-2 rounded-full bg-[#5B3FE0]" />
        <div className="h-1.5 w-12 rounded-full bg-[#1C1D1F]/80" />
      </div>
      <div className="theme-preview-card flex-1 rounded-md border p-1.5 space-y-1 shadow-sm">
        <div className="h-1 w-3/4 rounded-full bg-[#1C1D1F]/45" />
        <div className="h-1 w-1/2 rounded-full bg-[#6A6F7C]/80" />
        <div className="mt-1 h-4 w-10 rounded bg-[#5B3FE0]" />
      </div>
    </div>
  );
}

export function AppearanceSettings() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Choose how SecureMind looks. Dark remains the default. Your choice is saved on this
          device and applies immediately across the whole app.
        </p>
      </div>

      <div
        role="radiogroup"
        aria-label="Theme"
        className="grid gap-3 sm:grid-cols-2"
      >
        {OPTIONS.map(opt => {
          const selected = theme === opt.id;
          const Icon = opt.id === "dark" ? Moon : Sun;
          return (
            <button
              key={opt.id}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={`${opt.label} theme`}
              onClick={() => setTheme(opt.id)}
              onKeyDown={e => {
                if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                  e.preventDefault();
                  setTheme(opt.id === "dark" ? "light" : "dark");
                }
              }}
              className={cn(
                "group relative rounded-xl border p-3 text-left transition-all cursor-pointer",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                selected
                  ? "border-primary/50 bg-primary/10 shadow-sm ring-1 ring-primary/25"
                  : "border-border bg-card hover:border-foreground/20 hover:bg-accent/40",
              )}
            >
              <opt.Preview />
              <div className="mt-3 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <Icon className="size-3.5 text-muted-foreground shrink-0" aria-hidden />
                    <span className="text-sm font-semibold text-foreground">{opt.label}</span>
                  </div>
                  <p className="text-[0.68rem] text-muted-foreground mt-0.5 leading-relaxed">
                    {opt.description}
                  </p>
                </div>
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors",
                    selected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-transparent",
                  )}
                  aria-hidden
                >
                  <Check className="size-3" />
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
