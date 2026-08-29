"use client";

/**
 * Dark-themed select.
 *
 * A native <select> renders its option list with the operating system's own
 * popup, which stays light on Windows regardless of CSS — unreadable against
 * this UI. This is a button + listbox that we fully control.
 */

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type SelectOption = {
  value: string;
  label: string;
  hint?: string;
};

type Props = {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  mono?: boolean;
  className?: string;
  "aria-label"?: string;
};

export function SelectMenu({
  value,
  options,
  onChange,
  placeholder = "Select…",
  disabled = false,
  mono = false,
  className,
  "aria-label": ariaLabel,
}: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const selected = options.find(o => o.value === value) ?? null;

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  /** Opening highlights the current value — done here, not in an effect. */
  function openMenu() {
    setActive(Math.max(0, options.findIndex(o => o.value === value)));
    setOpen(true);
  }

  function commit(next: string) {
    setOpen(false);
    if (next !== value) onChange(next);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!open && (e.key === "Enter" || e.key === " " || e.key === "ArrowDown")) {
      e.preventDefault();
      openMenu();
      return;
    }
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(i => Math.min(options.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(i => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const opt = options[active];
      if (opt) commit(opt.value);
    }
  }

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
        className={cn(
          "w-full h-9 flex items-center justify-between gap-2 rounded-lg border border-border",
          "bg-card px-2.5 text-xs text-left focus:outline-none focus:ring-2 focus:ring-ring",
          "disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]",
          selected ? "text-foreground" : "text-muted-foreground",
          mono && selected && "font-mono",
        )}
      >
        <span className="truncate">{selected ? selected.label : placeholder}</span>
        <ChevronDown
          className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </button>

      {open && (
        <ul
          id={listId}
          role="listbox"
          className={cn(
            "absolute z-50 mt-1 w-full max-h-60 overflow-y-auto rounded-lg p-1",
            "border border-border bg-popover text-popover-foreground shadow-[var(--shadow-lg)]",
          )}
        >
          {options.length === 0 && (
            <li className="px-2.5 py-2 text-[0.65rem] text-muted-foreground">No options available</li>
          )}
          {options.map((o, i) => (
            <li key={o.value} role="option" aria-selected={o.value === value}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => commit(o.value)}
                className={cn(
                  "w-full flex items-start gap-2 rounded-md px-2.5 py-1.5 text-left text-xs cursor-pointer",
                  i === active
                    ? "bg-[var(--surface-selected)] text-[var(--primary-soft-foreground)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]",
                )}
              >
                <Check
                  className={cn(
                    "size-3.5 shrink-0 mt-0.5",
                    o.value === value ? "text-[var(--primary-soft-foreground)]" : "opacity-0",
                  )}
                  aria-hidden
                />
                <span className="min-w-0">
                  <span className={cn("block truncate", mono && "font-mono")}>{o.label}</span>
                  {o.hint && (
                    <span className="block text-[0.58rem] text-muted-foreground truncate">{o.hint}</span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
