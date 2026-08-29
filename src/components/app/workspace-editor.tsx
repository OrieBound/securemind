"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import EmojiPicker, { Theme, type EmojiClickData } from "emoji-picker-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/app/theme-provider";
import { cn } from "@/lib/utils";

type WorkspaceFields = {
  id: string;
  name: string;
  emoji: string;
  color: string;
  description: string | null;
  context: string | null;
};

type Props = {
  workspace: WorkspaceFields;
  onSave: (patch: {
    name?: string;
    emoji?: string;
    color?: string;
    description?: string | null;
    context?: string | null;
  }) => Promise<void>;
  onDelete?: () => void;
};

const COLORS = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"];

/** Curated icons for ops / security workspaces */
const WORKSPACE_ICONS = [
  "🗂️", "🔐", "🛡️", "🔑", "💳", "🌐", "☁️", "📡",
  "🧠", "⚡", "🔍", "📋", "🧾", "🗄️", "⚙️", "🚨",
  "🧪", "📊", "🔗", "🧬", "🛰️", "💡", "🎯", "🔒",
] as const;

export function WorkspaceEditor({ workspace, onSave, onDelete }: Props) {
  const { theme } = useTheme();
  const [name, setName] = useState(workspace.name);
  const [emoji, setEmoji] = useState(workspace.emoji || "🗂️");
  const [color, setColor] = useState(workspace.color);
  const [description, setDescription] = useState(workspace.description ?? "");
  const [context, setContext] = useState(workspace.context ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const moreBtnRef = useRef<HTMLButtonElement>(null);

  // Parent remounts this editor with key={workspace.id} when switching workspaces.

  useEffect(() => {
    if (!pickerOpen) return;
    function onPointerDown(e: MouseEvent) {
      const t = e.target as Node;
      if (pickerRef.current?.contains(t) || moreBtnRef.current?.contains(t)) return;
      setPickerOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [pickerOpen]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("A workspace name is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave({
        name: trimmed,
        emoji: emoji.trim() || "🗂️",
        color,
        description: description.trim() || null,
        context: context.trim() || null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function pickIcon(next: string) {
    setEmoji(next);
    setPickerOpen(false);
  }

  return (
    <form onSubmit={handleSave} className="space-y-5 max-w-xl">
      <div className="flex items-start gap-3">
        <div
          className="workspace-avatar size-12 shrink-0 rounded-xl flex items-center justify-center text-xl select-none"
          style={{ "--ws-accent": color } as CSSProperties}
          aria-hidden
        >
          {emoji || "🗂️"}
        </div>
        <div className="flex-1 min-w-0 space-y-2">
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Workspace name"
            maxLength={60}
            className="w-full h-10 rounded-lg border border-foreground/10 bg-foreground/[0.04] px-3 text-sm text-foreground/85 placeholder:text-foreground/25 focus:outline-none focus:ring-1 focus:ring-indigo-500/40"
          />
          <input
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Short description — e.g. AuthN, sessions, MFA"
            maxLength={140}
            className="w-full h-9 rounded-lg border border-foreground/10 bg-foreground/[0.04] px-3 text-xs text-foreground/70 placeholder:text-foreground/25 focus:outline-none focus:ring-1 focus:ring-indigo-500/40"
          />
        </div>
      </div>

      <div>
        <p className="text-[0.65rem] uppercase tracking-wider text-foreground/30 font-semibold mb-2">Icon</p>
        <div className="flex flex-wrap gap-1.5">
          {WORKSPACE_ICONS.map(icon => (
            <button
              key={icon}
              type="button"
              onClick={() => pickIcon(icon)}
              aria-label={`Icon ${icon}`}
              aria-pressed={emoji === icon}
              className={cn(
                "size-9 rounded-lg text-base flex items-center justify-center transition-all cursor-pointer",
                "border bg-foreground/[0.03] hover:bg-foreground/[0.08]",
                emoji === icon
                  ? "border-indigo-400/50 bg-indigo-500/15 ring-1 ring-indigo-400/30"
                  : "border-foreground/8",
              )}
            >
              {icon}
            </button>
          ))}
          <div className="relative">
            <button
              ref={moreBtnRef}
              type="button"
              onClick={() => setPickerOpen(o => !o)}
              aria-expanded={pickerOpen}
              aria-label="Browse more icons"
              className={cn(
                "size-9 rounded-lg text-[0.65rem] font-medium flex items-center justify-center transition-all cursor-pointer",
                "border bg-foreground/[0.03] hover:bg-foreground/[0.08] text-foreground/45",
                pickerOpen
                  ? "border-indigo-400/50 bg-indigo-500/15 text-indigo-200"
                  : "border-foreground/8",
              )}
            >
              More
            </button>
            {pickerOpen && (
              <div
                ref={pickerRef}
                className="absolute left-0 top-11 z-50 shadow-2xl rounded-2xl overflow-hidden border border-foreground/10"
              >
                <EmojiPicker
                  theme={theme === "dark" ? Theme.DARK : Theme.LIGHT}
                  onEmojiClick={(data: EmojiClickData) => pickIcon(data.emoji)}
                  width={320}
                  height={380}
                  searchPlaceholder="Search emoji…"
                  previewConfig={{ showPreview: false }}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      <div>
        <p className="text-[0.65rem] uppercase tracking-wider text-foreground/30 font-semibold mb-2">Color</p>
        <div className="flex flex-wrap gap-2">
          {COLORS.map(c => (
            <button
              key={c}
              type="button"
              onClick={() => setColor(c)}
              aria-label={`Color ${c}`}
              aria-pressed={color === c}
              className={cn(
                "size-7 rounded-full border-2 transition-transform cursor-pointer",
                color === c ? "border-foreground scale-110" : "border-transparent hover:scale-105",
              )}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </div>

      <div>
        <label className="block text-[0.65rem] uppercase tracking-wider text-foreground/30 font-semibold mb-2">
          Operational context
        </label>
        <p className="text-[0.65rem] text-foreground/35 mb-2 leading-relaxed">
          What this workspace covers — injected into the system prompt so answers stay
          grounded in the right domain. For example: payment services, Stripe, PCI scope.
        </p>
        <textarea
          value={context}
          onChange={e => setContext(e.target.value)}
          rows={5}
          maxLength={2000}
          placeholder="Describe the systems, documents, and operational scope of this workspace…"
          className="w-full rounded-xl border border-foreground/10 bg-foreground/[0.04] px-3 py-2.5 text-xs text-foreground/70 placeholder:text-foreground/25 focus:outline-none focus:ring-1 focus:ring-indigo-500/40 resize-y min-h-[6rem]"
        />
      </div>

      {error && (
        <p role="alert" className="text-[0.7rem] text-red-300/90">{error}</p>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Button type="submit" disabled={saving} className="h-9 text-xs px-4">
          {saving ? "Saving…" : "Save workspace"}
        </Button>
        {onDelete && (
          <Button
            type="button"
            variant="outline"
            onClick={onDelete}
            className="h-9 text-xs px-3 border-red-400/30 text-red-300/80 hover:bg-red-400/10"
          >
            Delete workspace
          </Button>
        )}
      </div>
    </form>
  );
}
