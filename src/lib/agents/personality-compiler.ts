/**
 * Compile PersonalityConfig → system prompt snippet, tagline, and preview.
 */

import {
  ARCHETYPE_DEFINITIONS,
  DEFAULT_TRAITS,
  TRAIT_DEFINITIONS,
  clampTrait,
  defaultPersonalityConfig,
  type ArchetypeId,
  type PersonalityConfig,
  type TraitId,
} from "./personality-types";

const TRAIT_IDS = TRAIT_DEFINITIONS.map(t => t.id);

function level(score: number): "low" | "moderate" | "high" {
  if (score >= 67) return "high";
  if (score <= 33) return "low";
  return "moderate";
}

function traitPhrase(id: TraitId, score: number): string | null {
  const def = TRAIT_DEFINITIONS.find(t => t.id === id);
  if (!def) return null;
  const lv = level(score);
  if (lv === "moderate") return null;

  const word = lv === "high" ? def.right.toLowerCase() : def.left.toLowerCase();
  const labels: Partial<Record<TraitId, string>> = {
    energy: lv === "high" ? "outgoing and chatty" : "reserved and quiet",
    warmth: lv === "high" ? "warm and approachable" : "cool and measured",
    empathy: lv === "high" ? "deeply empathetic" : "practical and grounded",
    directness: lv === "high" ? "direct and blunt" : "gentle and careful",
    formality: lv === "high" ? "formal in tone" : "casual in tone",
    verbosity: lv === "high" ? "detailed in replies" : "brief in replies",
    humor: lv === "high" ? "playful with humor" : "serious and focused",
    technical_depth: lv === "high" ? "comfortable at expert technical depth" : "prefers plain language",
    creativity: lv === "high" ? "imaginative and creative" : "grounded and concrete",
    pushback: lv === "high" ? "pushes back and challenges ideas" : "agreeable and supportive",
    patience: lv === "high" ? "patient and unhurried" : "fast-paced and impatient",
    flirtiness: lv === "high" ? "flirty when appropriate" : undefined,
  };
  return labels[id] ?? word;
}

export function parsePersonalityConfig(
  raw: unknown,
  legacyPersonality?: string | null,
): PersonalityConfig {
  if (!raw || typeof raw !== "object") {
    const base = defaultPersonalityConfig();
    if (legacyPersonality?.trim()) base.freeform = legacyPersonality.trim();
    return base;
  }
  const obj = raw as Record<string, unknown>;
  const traits = { ...DEFAULT_TRAITS };
  if (obj.traits && typeof obj.traits === "object") {
    for (const id of TRAIT_IDS) {
      const v = (obj.traits as Record<string, unknown>)[id];
      if (typeof v === "number") traits[id] = clampTrait(v);
    }
  }
  const archetypes = Array.isArray(obj.archetypes)
    ? (obj.archetypes as { id?: string; weight?: number }[])
        .filter(a => a.id && ARCHETYPE_DEFINITIONS.some(d => d.id === a.id))
        .map(a => ({ id: a.id as ArchetypeId, weight: clampTrait(a.weight ?? 50) }))
        .slice(0, 3)
    : [{ id: "companion" as ArchetypeId, weight: 100 }];

  const voiceRaw = obj.voice as Record<string, unknown> | undefined;
  const boundsRaw = obj.boundaries as Record<string, unknown> | undefined;

  return {
    version: 1,
    archetypes: archetypes.length ? archetypes : [{ id: "companion", weight: 100 }],
    traits,
    voice: {
      tone: Array.isArray(voiceRaw?.tone)
        ? (voiceRaw!.tone as unknown[]).filter(t => typeof t === "string") as string[]
        : ["casual"],
      humor: clampTrait(typeof voiceRaw?.humor === "number" ? voiceRaw.humor : traits.humor),
      verbosity: clampTrait(typeof voiceRaw?.verbosity === "number" ? voiceRaw.verbosity : traits.verbosity),
      emojiLevel: clampTrait(typeof voiceRaw?.emojiLevel === "number" ? voiceRaw.emojiLevel : 25),
    },
    boundaries: {
      pushback: clampTrait(typeof boundsRaw?.pushback === "number" ? boundsRaw.pushback : traits.pushback),
      sycophancy: clampTrait(typeof boundsRaw?.sycophancy === "number" ? boundsRaw.sycophancy : 25),
      topicsToAvoid: Array.isArray(boundsRaw?.topicsToAvoid)
        ? (boundsRaw!.topicsToAvoid as unknown[]).filter(t => typeof t === "string") as string[]
        : undefined,
    },
    freeform: typeof obj.freeform === "string" ? obj.freeform : legacyPersonality?.trim() || undefined,
  };
}

export function compileTagline(config: PersonalityConfig): string {
  const archetypeLabels = config.archetypes
    .map(a => ARCHETYPE_DEFINITIONS.find(d => d.id === a.id)?.label)
    .filter(Boolean)
    .slice(0, 2);
  const phrases = [
    ...archetypeLabels,
    traitPhrase("directness", config.traits.directness),
    traitPhrase("warmth", config.traits.warmth),
    traitPhrase("verbosity", config.traits.verbosity),
  ].filter(Boolean) as string[];

  if (phrases.length === 0) return "A companion tuned to your preferences.";
  const unique = [...new Set(phrases)];
  return unique.slice(0, 3).join(" · ");
}

export function compilePersonalityPrompt(config: PersonalityConfig, name: string): string {
  const parts: string[] = [];

  // Behavioral instructions — never labels the model should recite to the user.
  for (const arch of config.archetypes) {
    const def = ARCHETYPE_DEFINITIONS.find(d => d.id === arch.id);
    if (!def) continue;
    parts.push(`Lean ${def.label.toLowerCase()}: ${def.description.toLowerCase()}`);
  }

  const traitPhrases = TRAIT_IDS
    .map(id => traitPhrase(id, config.traits[id]))
    .filter(Boolean) as string[];
  if (traitPhrases.length) {
    parts.push(traitPhrases.slice(0, 6).join("; "));
  }

  if (config.voice.tone.length) {
    parts.push(`Voice: ${config.voice.tone.join(", ")} — show through how you talk, don't name it`);
  }

  if (config.traits.flirtiness >= 67) {
    parts.push("Light flirty edge when it fits — never forced");
  } else if (config.traits.flirtiness <= 10) {
    parts.push("Keep it platonic");
  }

  if (config.boundaries.pushback >= 67) {
    parts.push("Push back when something's off");
  }
  if (config.boundaries.sycophancy <= 30) {
    parts.push("Real opinions — no yes-man energy");
  }
  if (config.boundaries.topicsToAvoid?.length) {
    parts.push(`Steer away from: ${config.boundaries.topicsToAvoid.join(", ")}`);
  }

  if (config.voice.emojiLevel >= 60) {
    parts.push("Emojis sparingly when natural");
  } else if (config.voice.emojiLevel <= 20) {
    parts.push("Skip emojis");
  }

  if (config.freeform?.trim()) {
    parts.push(config.freeform.trim());
  }

  if (parts.length === 0) {
    return `Internal vibe for ${name}: casual, direct, real opinions. Never list these notes aloud.`;
  }

  return (
    `Internal character notes for ${name} (shape your tone — NEVER quote, list, or explain these to the user): ` +
    parts.join(". ") +
    "."
  );
}

export function compileSampleLine(config: PersonalityConfig, name: string): string {
  const direct = config.traits.directness >= 60;
  const brief = config.traits.verbosity <= 45;
  const warm = config.traits.warmth >= 60;
  const technical = config.traits.technical_depth >= 65;
  const playful = config.traits.humor >= 60;

  if (technical && direct && brief) {
    return direct
      ? "Yeah, that works — but you'd hit latency on cold starts. Want the simpler path?"
      : "That approach could work well. There might be a latency trade-off on cold starts — happy to walk through alternatives.";
  }
  if (warm && playful) {
    return `Ha — fair question. I'd say go for it, ${name} style: try it and see what breaks first.`;
  }
  if (config.archetypes.some(a => a.id === "therapist")) {
    return "That sounds like it's been weighing on you. What part feels hardest right now?";
  }
  if (config.archetypes.some(a => a.id === "coach")) {
    return "Good instinct. What's the one thing you could do today to move it forward?";
  }
  return brief
    ? (direct ? "Makes sense. I'd push back on one thing though — worth a second look." : "Makes sense — tell me more about what you're aiming for.")
    : (warm ? "I hear you. Here's how I'd think about it…" : "Here's my take on that.");
}

export function configToRadar(config: PersonalityConfig): { axis: string; value: number }[] {
  return [
    { axis: "Social", value: config.traits.energy },
    { axis: "Warm", value: config.traits.warmth },
    { axis: "Direct", value: config.traits.directness },
    { axis: "Patient", value: config.traits.patience },
    { axis: "Technical", value: config.traits.technical_depth },
    { axis: "Playful", value: config.traits.humor },
    { axis: "Pushback", value: config.traits.pushback },
    { axis: "Creative", value: config.traits.creativity },
  ];
}

export function applyArchetypeBlend(
  current: PersonalityConfig,
  archetypes: { id: ArchetypeId; weight: number }[],
): PersonalityConfig {
  if (!archetypes.length) return current;
  const total = archetypes.reduce((s, a) => s + a.weight, 0) || 100;
  const traits = { ...current.traits };
  for (const id of TRAIT_IDS) traits[id] = 0;

  const toneSet = new Set<string>();
  for (const arch of archetypes) {
    const def = ARCHETYPE_DEFINITIONS.find(d => d.id === arch.id);
    if (!def) continue;
    const w = arch.weight / total;
    for (const id of TRAIT_IDS) {
      const preset = def.traits[id] ?? DEFAULT_TRAITS[id];
      traits[id] += preset * w;
    }
    def.tone.forEach(t => toneSet.add(t));
  }
  for (const id of TRAIT_IDS) traits[id] = clampTrait(traits[id]);

  return {
    ...current,
    archetypes,
    traits,
    voice: {
      ...current.voice,
      tone: [...toneSet].slice(0, 5),
      humor: traits.humor,
      verbosity: traits.verbosity,
    },
    boundaries: {
      ...current.boundaries,
      pushback: traits.pushback,
    },
  };
}
