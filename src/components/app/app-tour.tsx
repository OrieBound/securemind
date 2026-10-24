"use client";

/**
 * First-run tour for the signed-in app. A short, skippable walk through the main areas, shown once
 * per account on this browser and available again from "Take the tour" in the header. The wording
 * is for the person using SecureMind, with one Admin-only sentence on the Settings step.
 */

import { useEffect, useId, useState } from "react";

const TOUR_KEY_PREFIX = "sm_tour_v1:";

export function tourStorageKey(accountKey: string): string {
  return `${TOUR_KEY_PREFIX}${accountKey.trim().toLowerCase() || "local"}`;
}

type Step = {
  target: string;
  title: string;
  body: string;
  /** Sit the note on the target instead of beside it. */
  place?: "above";
};

export function tourSteps(isAdmin: boolean): Step[] {
  return [
    {
      target: "workspaces",
      title: "Workspaces",
      body: "Each workspace has its own chat, Knowledge files and memory, and they stay inside it. Use + to start another one. The name you give a workspace is the name the assistant answers to.",
    },
    {
      target: "features",
      title: "Chat, Knowledge, Memory",
      body: "Chat is where you talk. Knowledge holds files you add, so answers can point to where they came from. Memory keeps facts you stated yourself, and Workspace sets the name and background.",
    },
    {
      target: "composer",
      title: "Your message",
      place: "above",
      body: "Type here, attach a file, or use the microphone. Before a message leaves your browser it is checked for sensitive details. If anything is found you see what would be replaced and decide before sending. This lowers risk but cannot catch everything, so look it over.",
    },
    {
      target: "insights",
      title: "Insights",
      body: "Models shows which model handles each kind of request and why. Security lists what was detected and replaced. Cost tracks your usage against your monthly limit. These pages show your own account only.",
    },
    {
      target: "settings",
      title: "Settings",
      body: isAdmin
        ? "Settings holds your profile, appearance and detection preferences. As an Admin you also manage models, provider keys, users and monthly limits here."
        : "Settings holds your profile, appearance and detection preferences. Models and accounts are managed by your administrator, so ask them if something you expect is not available.",
    },
  ];
}

type Rect = { top: number; left: number; width: number; height: number };

export function AppTour({
  invite,
  active,
  isAdmin,
  onStart,
  onClose,
}: {
  invite: boolean;
  active: boolean;
  isAdmin: boolean;
  onStart: () => void;
  onClose: (reason: "done" | "skipped") => void;
}) {
  const titleId = useId();
  const steps = tourSteps(isAdmin);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const step = steps[index];
  const last = index === steps.length - 1;

  useEffect(() => {
    if (!active) setIndex(0);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    document.querySelector(`[data-tour="${step.target}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active, step.target]);

  useEffect(() => {
    if (!active) return;
    const measure = () => {
      const el = document.querySelector(`[data-tour="${step.target}"]`);
      if (!el) {
        setRect(null);
        return;
      }
      const box = el.getBoundingClientRect();
      if (box.width < 8 || box.height < 8) {
        setRect(null);
        return;
      }
      setRect({ top: box.top, left: box.left, width: box.width, height: box.height });
    };
    measure();
    const timer = window.setInterval(measure, 120);
    window.addEventListener("resize", measure);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("resize", measure);
    };
  }, [active, step.target]);

  const count = steps.length;
  useEffect(() => {
    if (!invite && !active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose("skipped");
      if (!active) return;
      if (event.key === "ArrowRight") setIndex(current => Math.min(count - 1, current + 1));
      if (event.key === "ArrowLeft") setIndex(current => Math.max(0, current - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [invite, active, onClose, count]);

  if (!invite && !active) return null;

  if (invite && !active) {
    return (
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/55 p-4">
        <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="w-full max-w-md rounded-2xl border border-foreground/10 bg-popover p-6 shadow-2xl">
          <p className="text-[0.62rem] font-semibold uppercase tracking-wider text-indigo-300/80">Welcome</p>
          <h2 id={titleId} className="mt-2 text-lg font-semibold text-foreground">A quick look around?</h2>
          <p className="mt-2 text-sm leading-relaxed text-foreground/55">
            A short tour points out chat, Knowledge, Insights and settings. You can skip it and start it again any time from Take the tour in the header.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={() => onClose("skipped")} className="rounded-lg px-3 py-2 text-sm text-foreground/55 hover:bg-foreground/5">
              Not now
            </button>
            <button type="button" autoFocus onClick={onStart} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500">
              Show me around
            </button>
          </div>
        </div>
      </div>
    );
  }

  const card = placeCard(rect, step.place);

  return (
    <div className="fixed inset-0 z-[200]">
      <div className="absolute inset-0" onClick={() => onClose("skipped")} />
      {rect ? <Spotlight rect={rect} /> : <div className="pointer-events-none absolute inset-0 bg-black/55" />}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="absolute w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-indigo-300/80 bg-popover p-5 shadow-[0_18px_48px_rgba(0,0,0,0.45),0_0_0_1px_rgba(165,180,252,0.25),0_0_22px_rgba(99,102,241,0.28)]"
        style={{ top: card.top, left: card.left }}
      >
        <CardArrow side={card.arrow} />
        <p className="text-[0.62rem] font-semibold uppercase tracking-wider text-indigo-300/80">
          {index + 1} of {steps.length}
        </p>
        <h2 id={titleId} className="mt-1.5 text-base font-semibold text-foreground">{step.title}</h2>
        <p className="mt-2 text-sm leading-relaxed text-foreground/55">{step.body}</p>
        <div className="mt-4 flex items-center justify-between gap-2">
          <button type="button" onClick={() => onClose("skipped")} className="text-sm text-foreground/45 hover:text-foreground/70">
            Skip tour
          </button>
          <div className="flex gap-2">
            {index > 0 && (
              <button type="button" onClick={() => setIndex(current => current - 1)} className="rounded-lg px-3 py-2 text-sm text-foreground/55 hover:bg-foreground/5">
                Back
              </button>
            )}
            <button
              type="button"
              autoFocus
              onClick={() => (last ? onClose("done") : setIndex(current => current + 1))}
              className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500"
            >
              {last ? "Done" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Spotlight({ rect }: { rect: Rect }) {
  const top = Math.max(0, rect.top - 6);
  const left = Math.max(0, rect.left - 6);
  const width = rect.width + 12;
  const height = rect.height + 12;
  const shade = "pointer-events-none absolute bg-black/60";
  return (
    <>
      <div className={shade} style={{ top: 0, left: 0, right: 0, height: top }} />
      <div className={shade} style={{ top: top + height, left: 0, right: 0, bottom: 0 }} />
      <div className={shade} style={{ top, left: 0, width: left, height }} />
      <div className={shade} style={{ top, left: left + width, right: 0, height }} />
      <div
        className="pointer-events-none absolute rounded-xl ring-2 ring-indigo-300/80 shadow-[0_0_0_3px_rgba(129,140,248,0.22),0_0_22px_rgba(129,140,248,0.42)]"
        style={{ top, left, width, height }}
      />
    </>
  );
}

function CardArrow({ side }: { side: "up" | "down" | "left" | "right" }) {
  const base = "absolute size-3 rotate-45 border-indigo-300/80 bg-popover";
  if (side === "down") return <span className={`${base} left-1/2 top-full -mt-1.5 -translate-x-1/2 border-b border-r`} />;
  if (side === "up") return <span className={`${base} bottom-full left-1/2 -mb-1.5 -translate-x-1/2 border-l border-t`} />;
  if (side === "left") return <span className={`${base} right-full top-8 -mr-1.5 border-b border-l`} />;
  return <span className={`${base} left-full top-8 -ml-1.5 border-r border-t`} />;
}

function placeCard(rect: Rect | null, prefer?: "above"): { top: number; left: number; arrow: "up" | "down" | "left" | "right" } {
  const width = Math.min(352, window.innerWidth - 32);
  const height = 250;
  if (!rect) {
    return {
      top: Math.max(16, (window.innerHeight - height) / 2),
      left: Math.max(16, (window.innerWidth - width) / 2),
      arrow: "down",
    };
  }
  const gap = 18;
  if (prefer === "above") {
    return {
      top: clamp(rect.top - height - gap, 16, window.innerHeight - height - 16),
      left: clamp(rect.left + (rect.width - width) / 2, 16, window.innerWidth - width - 16),
      arrow: "down",
    };
  }
  const roomRight = window.innerWidth - (rect.left + rect.width);
  const roomLeft = rect.left;
  if (roomRight >= width + gap) {
    return {
      top: clamp(rect.top, 16, window.innerHeight - height - 16),
      left: rect.left + rect.width + gap,
      arrow: "left",
    };
  }
  if (roomLeft >= width + gap) {
    return {
      top: clamp(rect.top, 16, window.innerHeight - height - 16),
      left: rect.left - width - gap,
      arrow: "right",
    };
  }
  if (rect.top > height + gap) {
    return {
      top: rect.top - height - gap,
      left: clamp(rect.left, 16, window.innerWidth - width - 16),
      arrow: "down",
    };
  }
  return {
    top: clamp(rect.top + rect.height + gap, 16, window.innerHeight - height - 16),
    left: clamp(rect.left, 16, window.innerWidth - width - 16),
    arrow: "up",
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}
