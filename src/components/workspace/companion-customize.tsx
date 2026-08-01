"use client";

import {
  Loader2,
  RotateCcw,
  Save,
  Shuffle,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PersonalityRadar } from "@/components/workspace/personality-radar";
import { TraitSlider } from "@/components/workspace/trait-slider";
import { COMPANION_COLORS, COMPANION_EMOJIS } from "@/lib/agents/constants";
import {
  compilePersonalityPrompt,
  compileSampleLine,
  compileTagline,
  configToRadar,
  parsePersonalityConfig,
} from "@/lib/agents/personality-compiler";
import { generateRandomConfig, isArchetypeActive, toggleArchetype } from "@/lib/agents/personality-presets";
import {
  ARCHETYPE_DEFINITIONS,
  TRAIT_DEFINITIONS,
  clampTrait,
  type PersonalityConfig,
  type TraitId,
} from "@/lib/agents/personality-types";
import { cn } from "@/lib/utils";

export type CompanionAgent = {
  id: string;
  name: string;
  emoji: string;
  color: string;
  personality: string | null;
  personalityConfig?: unknown;
  tagline?: string | null;
  isDefault: boolean;
};

type CustomizeTab = "overview" | "identity" | "archetypes" | "temperament" | "voice" | "advanced";

const TABS: { id: CustomizeTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "identity", label: "Identity" },
  { id: "archetypes", label: "Archetypes" },
  { id: "temperament", label: "Temperament" },
  { id: "voice", label: "Voice" },
  { id: "advanced", label: "Advanced" },
];

function agentToDraft(agent: CompanionAgent): {
  name: string;
  emoji: string;
  color: string;
  config: PersonalityConfig;
} {
  return {
    name: agent.name,
    emoji: agent.emoji,
    color: agent.color,
    config: parsePersonalityConfig(agent.personalityConfig, agent.personality),
  };
}

export function CompanionCustomize({
  agent,
  onSave,
  onDelete,
}: {
  agent: CompanionAgent;
  onSave: (patch: {
    name: string;
    emoji: string;
    color: string;
    personality: string;
    personalityConfig: PersonalityConfig;
    tagline: string;
  }) => Promise<void>;
  onDelete?: () => void;
}) {
  const [tab, setTab] = useState<CustomizeTab>("overview");
  const [name, setName] = useState(agent.name);
  const [emoji, setEmoji] = useState(agent.emoji);
  const [color, setColor] = useState(agent.color);
  const [config, setConfig] = useState<PersonalityConfig>(() =>
    parsePersonalityConfig(agent.personalityConfig, agent.personality),
  );
  const [savedSnapshot, setSavedSnapshot] = useState(() => JSON.stringify(agentToDraft(agent)));
  const [quickDesc, setQuickDesc] = useState("");
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  useEffect(() => {
    const draft = agentToDraft(agent);
    setName(draft.name);
    setEmoji(draft.emoji);
    setColor(draft.color);
    setConfig(draft.config);
    setSavedSnapshot(JSON.stringify(draft));
    setGenError(null);
  }, [agent.id, agent.name, agent.emoji, agent.color, agent.personality, agent.personalityConfig]);

  const dirty = useMemo(
    () => JSON.stringify({ name, emoji, color, config }) !== savedSnapshot,
    [name, emoji, color, config, savedSnapshot],
  );

  const tagline = useMemo(() => compileTagline(config), [config]);
  const compiled = useMemo(() => compilePersonalityPrompt(config, name || "Companion"), [config, name]);
  const sampleLine = useMemo(() => compileSampleLine(config, name || "Companion"), [config, name]);
  const radar = useMemo(() => configToRadar(config), [config]);

  const setTrait = useCallback((id: TraitId, value: number) => {
    setConfig(prev => ({
      ...prev,
      traits: { ...prev.traits, [id]: clampTrait(value) },
    }));
  }, []);

  const handleGenerate = async () => {
    if (!quickDesc.trim()) return;
    setGenerating(true);
    setGenError(null);
    try {
      const res = await fetch("/api/agents/generate-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: quickDesc.trim() }),
      });
      if (!res.ok) throw new Error("Generation failed");
      const { config: generated } = await res.json() as { config: PersonalityConfig };
      setConfig(parsePersonalityConfig(generated));
    } catch {
      setGenError("Couldn't generate — check your API key or try again.");
    } finally {
      setGenerating(false);
    }
  };

  const handleSurprise = () => {
    setConfig(generateRandomConfig());
    setGenError(null);
  };

  const handleReset = () => {
    const draft = JSON.parse(savedSnapshot) as ReturnType<typeof agentToDraft>;
    setName(draft.name);
    setEmoji(draft.emoji);
    setColor(draft.color);
    setConfig(draft.config);
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      const payload = {
        name: name.trim(),
        emoji,
        color,
        personality: compiled,
        personalityConfig: config,
        tagline,
      };
      await onSave(payload);
      setSavedSnapshot(JSON.stringify({ name: payload.name, emoji, color, config }));
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Save failed — try restarting the dev server.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Quick Start */}
      <section className="rounded-xl border border-indigo-500/20 bg-indigo-500/[0.05] px-4 py-4 space-y-3">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-indigo-300/80" aria-hidden />
          <h3 className="text-[0.65rem] uppercase tracking-[0.2em] text-white/40 font-semibold">Quick start</h3>
        </div>
        <textarea
          value={quickDesc}
          onChange={e => setQuickDesc(e.target.value)}
          placeholder={'Describe your companion… e.g. "a cool friend who\'s blunt but never mean, loves architecture"'}
          rows={2}
          className="w-full rounded-xl bg-black/30 border border-white/10 px-3 py-2.5 text-sm text-white/80 placeholder:text-white/25 resize-none focus:outline-none focus:border-indigo-400/30"
        />
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            className="gap-1.5"
            disabled={!quickDesc.trim() || generating}
            onClick={handleGenerate}
          >
            {generating ? <Loader2 className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" />}
            Generate from description
          </Button>
          <Button type="button" size="sm" variant="outline" className="gap-1.5 border-white/10 bg-white/5" onClick={handleSurprise}>
            <Shuffle className="size-3.5" />
            Surprise me
          </Button>
        </div>
        {genError && <p className="text-xs text-red-400/80">{genError}</p>}
      </section>

      {/* Preview + actions */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] px-4 py-3 flex-1 min-w-[200px]">
          <div className="flex items-center gap-3 mb-2">
            <span
              className="flex size-10 items-center justify-center rounded-xl text-xl"
              style={{ backgroundColor: color + "28", border: `1px solid ${color}55` }}
            >
              {emoji}
            </span>
            <div className="min-w-0">
              <p className="font-semibold text-white/90">{name || "Companion"}</p>
              <p className="text-xs text-white/40 truncate">{tagline}</p>
            </div>
          </div>
          <p className="text-sm text-white/50 leading-relaxed border-l-2 border-indigo-400/30 pl-3 italic">
            &ldquo;{sampleLine}&rdquo;
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button type="button" size="sm" variant="outline" className="border-white/10" disabled={!dirty} onClick={handleReset}>
            <RotateCcw className="size-3.5 mr-1.5" />
            Reset
          </Button>
          <Button type="button" size="sm" disabled={!dirty || saving || !name.trim()} onClick={handleSave}>
            {saving ? <Loader2 className="size-3.5 mr-1.5 animate-spin" /> : <Save className="size-3.5 mr-1.5" />}
            Save{dirty ? " *" : ""}
          </Button>
        </div>
      </div>
      {saveError && (
        <p className="text-xs text-red-400/90 rounded-lg border border-red-500/20 bg-red-500/[0.06] px-3 py-2">
          {saveError}
        </p>
      )}

      {/* Tabs */}
      <div role="tablist" className="flex flex-wrap gap-1 rounded-xl border border-white/[0.07] bg-white/[0.02] p-1">
        {TABS.map(t => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "px-3 py-2 rounded-lg text-[0.78rem] font-medium transition-colors cursor-pointer",
              tab === t.id ? "bg-indigo-500/20 text-indigo-100" : "text-white/40 hover:text-white/65 hover:bg-white/[0.04]",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5">
            <h4 className="text-[0.65rem] uppercase tracking-[0.2em] text-white/35 font-semibold mb-4">Personality flow</h4>
            <PersonalityRadar axes={radar} />
          </div>
          <div className="space-y-3">
            <h4 className="text-[0.65rem] uppercase tracking-[0.2em] text-white/35 font-semibold">Active archetypes</h4>
            <div className="flex flex-wrap gap-2">
              {config.archetypes.map(a => {
                const def = ARCHETYPE_DEFINITIONS.find(d => d.id === a.id);
                return def ? (
                  <span key={a.id} className="rounded-lg border border-violet-500/20 bg-violet-500/10 px-2.5 py-1.5 text-xs text-violet-200/90">
                    {def.emoji} {def.label} · {a.weight}%
                  </span>
                ) : null;
              })}
            </div>
            <h4 className="text-[0.65rem] uppercase tracking-[0.2em] text-white/35 font-semibold pt-2">Compiled voice</h4>
            <p className="text-sm text-white/50 leading-relaxed">{compiled}</p>
          </div>
        </div>
      )}

      {tab === "identity" && (
        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-5 space-y-5 max-w-lg">
          <div className="flex gap-4">
            <div className="space-y-1 shrink-0">
              <label className="text-[0.65rem] text-white/35 uppercase tracking-wider">Icon</label>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowEmoji(p => !p)}
                  className="flex size-12 items-center justify-center rounded-xl text-2xl bg-white/6 border border-white/10 hover:border-white/20 cursor-pointer"
                >
                  {emoji}
                </button>
                {showEmoji && (
                  <div className="absolute top-full left-0 mt-2 z-10 w-64 rounded-2xl bg-[#0e0e14] border border-white/10 shadow-2xl p-3">
                    <div className="grid grid-cols-8 gap-1 max-h-40 overflow-y-auto">
                      {COMPANION_EMOJIS.map(e => (
                        <button
                          key={e}
                          type="button"
                          onClick={() => { setEmoji(e); setShowEmoji(false); }}
                          className={cn(
                            "flex size-8 items-center justify-center rounded-lg text-lg hover:bg-white/10 cursor-pointer",
                            emoji === e && "bg-indigo-400/20 ring-1 ring-indigo-400/40",
                          )}
                        >
                          {e}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="space-y-1 flex-1">
              <label className="text-[0.65rem] text-white/35 uppercase tracking-wider">Name</label>
              <Input value={name} onChange={e => setName(e.target.value)} maxLength={32} className="h-10 bg-white/6 border-white/10" />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-[0.65rem] text-white/35 uppercase tracking-wider">Accent color</label>
            <div className="flex flex-wrap gap-2">
              {COMPANION_COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={cn(
                    "size-8 rounded-lg border-2 cursor-pointer transition-transform hover:scale-105",
                    color === c ? "border-white/80 scale-110" : "border-transparent",
                  )}
                  style={{ backgroundColor: c }}
                  title={c}
                />
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-[0.65rem] text-white/35 uppercase tracking-wider">Tagline (auto-generated on save)</label>
            <p className="text-sm text-white/55 italic">{tagline}</p>
          </div>
        </div>
      )}

      {tab === "archetypes" && (
        <div className="space-y-3">
          <p className="text-sm text-white/40">Select up to 3 — sliders adjust to match the blend.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {ARCHETYPE_DEFINITIONS.map(def => {
              const active = isArchetypeActive(config, def.id);
              const weight = config.archetypes.find(a => a.id === def.id)?.weight;
              return (
                <button
                  key={def.id}
                  type="button"
                  onClick={() => setConfig(toggleArchetype(config, def.id))}
                  className={cn(
                    "rounded-xl border px-4 py-3.5 text-left transition-colors cursor-pointer",
                    active
                      ? "border-indigo-400/35 bg-indigo-500/[0.08]"
                      : "border-white/[0.07] bg-white/[0.02] hover:border-white/12",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-lg">{def.emoji}</span>
                    {active && weight != null && (
                      <span className="text-[0.62rem] font-mono text-indigo-300/70">{weight}%</span>
                    )}
                  </div>
                  <p className="text-sm font-medium text-white/80 mt-1">{def.label}</p>
                  <p className="text-xs text-white/35 mt-0.5">{def.description}</p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {tab === "temperament" && (
        <div className="space-y-6">
          {(["social", "communication", "cognitive"] as const).map(group => (
            <div key={group}>
              <h4 className="text-[0.62rem] uppercase tracking-[0.18em] text-white/30 font-semibold mb-2.5 capitalize">{group}</h4>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
                {TRAIT_DEFINITIONS.filter(t => t.group === group).map(t => (
                  <TraitSlider
                    key={t.id}
                    label={t.label}
                    left={t.left}
                    right={t.right}
                    value={config.traits[t.id]}
                    onChange={v => setTrait(t.id, v)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "voice" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5 max-w-3xl">
          <TraitSlider label="Humor" left="Serious" right="Playful" value={config.voice.humor} onChange={v => setConfig(p => ({ ...p, voice: { ...p.voice, humor: v } }))} />
          <TraitSlider label="Reply length" left="Brief" right="Detailed" value={config.voice.verbosity} onChange={v => setConfig(p => ({ ...p, voice: { ...p.voice, verbosity: v }, traits: { ...p.traits, verbosity: v } }))} />
          <TraitSlider label="Emoji use" left="Minimal" right="Expressive" value={config.voice.emojiLevel} onChange={v => setConfig(p => ({ ...p, voice: { ...p.voice, emojiLevel: v } }))} />
          <TraitSlider label="Pushback" left="Agreeable" right="Challenging" value={config.boundaries.pushback} onChange={v => setConfig(p => ({ ...p, boundaries: { ...p.boundaries, pushback: v }, traits: { ...p.traits, pushback: v } }))} />
          <TraitSlider label="Sycophancy" left="Independent" right="People-pleasing" value={config.boundaries.sycophancy} onChange={v => setConfig(p => ({ ...p, boundaries: { ...p.boundaries, sycophancy: v } }))} />
        </div>
      )}

      {tab === "advanced" && (
        <div className="space-y-4 max-w-2xl">
          <div className="space-y-1">
            <label className="text-[0.65rem] text-white/35 uppercase tracking-wider">Freeform override</label>
            <textarea
              value={config.freeform ?? ""}
              onChange={e => setConfig(p => ({ ...p, freeform: e.target.value }))}
              placeholder="Optional extra instructions merged into the personality prompt…"
              rows={3}
              className="w-full rounded-xl bg-white/6 border border-white/10 px-3 py-2 text-sm text-white/80 placeholder:text-white/25 resize-none focus:outline-none focus:border-white/20"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[0.65rem] text-white/35 uppercase tracking-wider">Compiled prompt (sent to model)</label>
            <pre className="rounded-xl border border-white/[0.06] bg-black/30 px-3 py-3 text-xs text-white/45 leading-relaxed whitespace-pre-wrap font-sans">
              {compiled}
            </pre>
          </div>
        </div>
      )}

      {!agent.isDefault && onDelete && (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/[0.06] px-5 py-4 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <p className="text-sm font-semibold text-red-300/90">Remove companion</p>
            <p className="text-xs text-white/40 mt-1">Deletes chat history, memory, and documents for {name}.</p>
          </div>
          <Button type="button" variant="outline" className="border-red-500/30 text-red-400 hover:bg-red-500/10" onClick={onDelete}>
            <Trash2 className="size-3.5 mr-1.5" />
            Delete
          </Button>
        </div>
      )}
    </div>
  );
}
