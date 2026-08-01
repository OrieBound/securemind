"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
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

export function WorkspaceEditor({ workspace, onSave, onDelete }: Props) {
  const [name, setName] = useState(workspace.name);
  const [emoji, setEmoji] = useState(workspace.emoji);
  const [color, setColor] = useState(workspace.color);
  const [description, setDescription] = useState(workspace.description ?? "");
  const [context, setContext] = useState(workspace.context ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <form onSubmit={handleSave} className="space-y-5 max-w-xl">
      <div className="flex items-start gap-3">
        <input
          value={emoji}
          onChange={e => setEmoji(e.target.value)}
          aria-label="Emoji"
          className="size-12 shrink-0 rounded-xl border border-white/10 bg-white/[0.04] text-center text-xl focus:outline-none focus:ring-1 focus:ring-indigo-500/40"
        />
        <div className="flex-1 min-w-0 space-y-2">
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Workspace name"
            maxLength={60}
            className="w-full h-10 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-sm text-white/85 placeholder:text-white/25 focus:outline-none focus:ring-1 focus:ring-indigo-500/40"
          />
          <input
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Short description"
            maxLength={140}
            className="w-full h-9 rounded-lg border border-white/10 bg-white/[0.04] px-3 text-xs text-white/70 placeholder:text-white/25 focus:outline-none focus:ring-1 focus:ring-indigo-500/40"
          />
        </div>
      </div>

      <div>
        <p className="text-[0.65rem] uppercase tracking-wider text-white/30 font-semibold mb-2">Color</p>
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
                color === c ? "border-white scale-110" : "border-transparent hover:scale-105",
              )}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </div>

      <div>
        <label className="block text-[0.65rem] uppercase tracking-wider text-white/30 font-semibold mb-2">
          Operational context
        </label>
        <p className="text-[0.65rem] text-white/35 mb-2 leading-relaxed">
          What this workspace covers — injected into the system prompt so answers stay
          grounded in the right domain. For example: payment services, Stripe, PCI scope.
        </p>
        <textarea
          value={context}
          onChange={e => setContext(e.target.value)}
          rows={5}
          maxLength={2000}
          placeholder="Describe the systems, documents, and operational scope of this workspace…"
          className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-xs text-white/70 placeholder:text-white/25 focus:outline-none focus:ring-1 focus:ring-indigo-500/40 resize-y min-h-[6rem]"
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
