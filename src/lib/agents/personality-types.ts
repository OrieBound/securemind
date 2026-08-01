/** Structured companion personality — source of truth for Customize. */

export type TraitId =
  | "energy"
  | "warmth"
  | "empathy"
  | "sensitivity"
  | "patience"
  | "directness"
  | "formality"
  | "verbosity"
  | "humor"
  | "politeness"
  | "technical_depth"
  | "creativity"
  | "pushback"
  | "structure"
  | "flirtiness";

export type ArchetypeId =
  | "companion"
  | "engineer"
  | "therapist"
  | "mentor"
  | "coach"
  | "creative"
  | "challenger"
  | "analyst";

export type PersonalityConfig = {
  version: 1;
  archetypes: { id: ArchetypeId; weight: number }[];
  traits: Record<TraitId, number>;
  voice: {
    tone: string[];
    humor: number;
    verbosity: number;
    emojiLevel: number;
  };
  boundaries: {
    pushback: number;
    sycophancy: number;
    topicsToAvoid?: string[];
  };
  freeform?: string;
};

export type TraitDefinition = {
  id: TraitId;
  label: string;
  left: string;
  right: string;
  group: "social" | "communication" | "cognitive";
};

export const TRAIT_DEFINITIONS: TraitDefinition[] = [
  { id: "energy",          label: "Social energy",   left: "Reserved",  right: "Outgoing",     group: "social" },
  { id: "warmth",          label: "Warmth",          left: "Cool",      right: "Warm",         group: "social" },
  { id: "empathy",         label: "Empathy",         left: "Practical", right: "Empathetic",   group: "social" },
  { id: "sensitivity",     label: "Sensitivity",     left: "Thick-skinned", right: "Attuned", group: "social" },
  { id: "patience",        label: "Patience",        left: "Impatient", right: "Patient",      group: "social" },
  { id: "directness",      label: "Directness",      left: "Gentle",    right: "Blunt",        group: "communication" },
  { id: "formality",       label: "Formality",       left: "Casual",    right: "Formal",       group: "communication" },
  { id: "verbosity",       label: "Verbosity",       left: "Brief",     right: "Detailed",     group: "communication" },
  { id: "humor",           label: "Humor",           left: "Serious",   right: "Playful",      group: "communication" },
  { id: "politeness",      label: "Politeness",      left: "Irreverent", right: "Polite",      group: "communication" },
  { id: "technical_depth", label: "Technical depth", left: "Plain",     right: "Expert",       group: "cognitive" },
  { id: "creativity",      label: "Creativity",      left: "Grounded",  right: "Imaginative",  group: "cognitive" },
  { id: "pushback",        label: "Pushback",        left: "Agreeable", right: "Challenging",  group: "cognitive" },
  { id: "structure",       label: "Structure",       left: "Free-flow", right: "Step-by-step", group: "cognitive" },
  { id: "flirtiness",      label: "Flirtiness",      left: "None",      right: "Flirty",       group: "social" },
];

export type ArchetypeDefinition = {
  id: ArchetypeId;
  label: string;
  description: string;
  emoji: string;
  traits: Partial<Record<TraitId, number>>;
  tone: string[];
};

export const ARCHETYPE_DEFINITIONS: ArchetypeDefinition[] = [
  {
    id: "companion", label: "Companion", emoji: "✨",
    description: "Warm, casual, real opinions",
    traits: { warmth: 72, energy: 58, directness: 55, verbosity: 40, humor: 50 },
    tone: ["casual", "warm"],
  },
  {
    id: "engineer", label: "Engineer", emoji: "⚙️",
    description: "Technical, precise, peer-level",
    traits: { technical_depth: 85, directness: 70, structure: 75, warmth: 45, verbosity: 45 },
    tone: ["direct", "technical"],
  },
  {
    id: "therapist", label: "Therapist", emoji: "💜",
    description: "Empathetic, patient, reflective",
    traits: { empathy: 88, patience: 82, sensitivity: 80, directness: 35, pushback: 30 },
    tone: ["gentle", "reflective"],
  },
  {
    id: "mentor", label: "Mentor", emoji: "🎓",
    description: "Teaches clearly, structured guidance",
    traits: { structure: 80, patience: 70, warmth: 60, verbosity: 65, technical_depth: 60 },
    tone: ["supportive", "clear"],
  },
  {
    id: "coach", label: "Coach", emoji: "🏃",
    description: "Motivating, accountable, action-oriented",
    traits: { pushback: 75, energy: 70, structure: 70, directness: 65, warmth: 55 },
    tone: ["motivating", "direct"],
  },
  {
    id: "creative", label: "Creative", emoji: "🎨",
    description: "Imaginative, playful, unconventional",
    traits: { creativity: 88, humor: 75, structure: 30, formality: 25, energy: 65 },
    tone: ["playful", "imaginative"],
  },
  {
    id: "challenger", label: "Challenger", emoji: "⚔️",
    description: "Devil's advocate, blunt, no sycophancy",
    traits: { pushback: 90, directness: 85, warmth: 40, politeness: 35 },
    tone: ["blunt", "critical"],
  },
  {
    id: "analyst", label: "Analyst", emoji: "🔬",
    description: "Precise, neutral, evidence-first",
    traits: { technical_depth: 75, structure: 85, warmth: 35, humor: 25, verbosity: 55 },
    tone: ["precise", "neutral"],
  },
];

export const DEFAULT_TRAITS: Record<TraitId, number> = {
  energy: 55, warmth: 62, empathy: 50, sensitivity: 50, patience: 55,
  directness: 58, formality: 30, verbosity: 40, humor: 45, politeness: 50,
  technical_depth: 50, creativity: 45, pushback: 50, structure: 50, flirtiness: 5,
};

export function defaultPersonalityConfig(): PersonalityConfig {
  return {
    version: 1,
    archetypes: [{ id: "companion", weight: 100 }],
    traits: { ...DEFAULT_TRAITS },
    voice: { tone: ["casual", "direct"], humor: 45, verbosity: 40, emojiLevel: 25 },
    boundaries: { pushback: 50, sycophancy: 25 },
  };
}

export function clampTrait(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}
