/**
 * Personality inference from extracted facts + conversation summaries.
 * Scores are 0–100; evidence cites stored facts or summary snippets.
 */

import { formatFactValue } from "@/lib/memory/format";

export type PersonalityTrait = {
  id: string;
  label: string;
  score: number;
  level: "Low" | "Moderate" | "High";
  evidence: string[];
  category: "social" | "emotional" | "communication" | "cognitive";
};

export type RadarAxis = { axis: string; value: number };

export type PersonalityProfile = {
  traits: PersonalityTrait[];
  radar: RadarAxis[];
  narrative: string;
  topics: string[];
  problemDomains: string[];
  emotionalTags: string[];
};

type FactLike = { key: string; value: string };

const PERSONALITY_KEYS = new Set([
  "sociability",
  "talkativeness",
  "patience",
  "calmness",
  "sensitivity",
  "politeness",
  "preferred_problem_types",
  "emotional_tone",
]);

function factMap(facts: FactLike[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const f of facts) {
    map[f.key.toLowerCase()] = formatFactValue(f.value);
  }
  return map;
}

function level(score: number): "Low" | "Moderate" | "High" {
  if (score >= 67) return "High";
  if (score >= 34) return "Moderate";
  return "Low";
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

function keywordScore(text: string, patterns: { re: RegExp; weight: number }[]): number {
  const lower = text.toLowerCase();
  let score = 50;
  for (const { re, weight } of patterns) {
    if (re.test(lower)) score += weight;
  }
  return clamp(score);
}

function mapEnum(value: string | undefined, table: Record<string, number>, fallback = 50): number {
  if (!value || value === "—") return fallback;
  const key = value.toLowerCase().split(/[,/]/)[0]?.trim() ?? "";
  for (const [k, v] of Object.entries(table)) {
    if (key.includes(k)) return v;
  }
  return fallback;
}

export function isPersonalityKey(key: string): boolean {
  return PERSONALITY_KEYS.has(key.toLowerCase());
}

export function buildPersonalityProfile(
  facts: FactLike[],
  summaries: { summary: string }[],
): PersonalityProfile {
  const map = factMap(facts);
  const corpus = [
    ...summaries.map(s => s.summary),
    ...Object.values(map),
  ].join(" ").toLowerCase();

  const traits: PersonalityTrait[] = [];

  const sociability = map.sociability
    ? mapEnum(map.sociability, { low: 25, moderate: 55, medium: 55, high: 85 })
    : keywordScore(corpus, [
      { re: /\b(chat|talk|discuss|share|social|conversation)\b/g, weight: 8 },
      { re: /\b(alone|quiet|brief|minimal)\b/g, weight: -10 },
    ]);

  const talkativeness = map.talkativeness
    ? mapEnum(map.talkativeness, { low: 20, moderate: 50, high: 88 })
    : mapEnum(map.response_length, { short: 30, medium: 55, detailed: 80, long: 85 }, keywordScore(corpus, [
      { re: /\b(asked|mentioned|explained|described)\b/g, weight: 5 },
    ]));

  const patience = map.patience
    ? mapEnum(map.patience, { low: 25, moderate: 55, high: 85 })
    : keywordScore(corpus, [
      { re: /\b(wait|step by step|slowly|take your time|no rush)\b/g, weight: 12 },
      { re: /\b(hurry|asap|urgent|impatient|now)\b/g, weight: -15 },
    ]);

  const calmness = map.calmness
    ? mapEnum(map.calmness, { low: 25, moderate: 55, high: 85 })
    : keywordScore(corpus, [
      { re: /\b(calm|relaxed|steady|patient|thoughtful)\b/g, weight: 10 },
      { re: /\b(stress|frustrated|angry|upset|anxious|worried)\b/g, weight: -12 },
    ]);

  const sensitivity = map.sensitivity
    ? mapEnum(map.sensitivity, { low: 25, moderate: 55, high: 85 })
    : mapEnum(map.feedback_style, { gentle: 78, structured: 55, blunt: 28 }, 50);

  const politeness = map.politeness
    ? mapEnum(map.politeness, { low: 30, moderate: 55, high: 82 })
    : mapEnum(map.communication_style, { formal: 75, conversational: 60, direct: 40 }, keywordScore(corpus, [
      { re: /\b(please|thanks|thank you|appreciate)\b/g, weight: 8 },
    ]));

  const directness = mapEnum(map.communication_style, { direct: 88, conversational: 55, formal: 45 }, 50);
  const warmth = mapEnum(map.tone_preference, { warm: 85, casual: 65, professional: 45 }, 50);
  const technicalDepth = mapEnum(map.technical_level, { expert: 92, advanced: 80, intermediate: 55, beginner: 25 }, 45);
  const brevity = mapEnum(map.response_length, { short: 85, medium: 50, detailed: 25, long: 20 }, 50);
  const openness = keywordScore(corpus, [
    { re: /\b(personal|feel|honest|open|vulnerable|trust)\b/g, weight: 10 },
    { re: /\b(private|don't want to|rather not)\b/g, weight: -12 },
  ]);

  const push = (
    id: string,
    label: string,
    score: number,
    category: PersonalityTrait["category"],
    evidence: string[],
  ) => {
    traits.push({ id, label, score: clamp(score), level: level(score), evidence, category });
  };

  push("sociability", "Sociability", sociability, "social",
    evidenceFor(map, "sociability", "Prefers engaging, back-and-forth conversation"));
  push("talkativeness", "Talkativeness", talkativeness, "social",
    evidenceFor(map, "talkativeness", map.response_length ? `Response length: ${map.response_length}` : "Inferred from message depth"));
  push("patience", "Patience", patience, "emotional",
    evidenceFor(map, "patience", "Pace and tolerance in discussions"));
  push("calmness", "Calmness", calmness, "emotional",
    evidenceFor(map, "calmness", "Emotional steadiness in tone"));
  push("sensitivity", "Sensitivity", sensitivity, "emotional",
    evidenceFor(map, "sensitivity", map.feedback_style ? `Feedback preference: ${map.feedback_style}` : "Inferred from communication style"));
  push("politeness", "Politeness", politeness, "communication",
    evidenceFor(map, "politeness", map.communication_style ? `Style: ${map.communication_style}` : "Inferred from phrasing"));
  push("directness", "Directness", directness, "communication",
    [map.communication_style ? `Communication: ${map.communication_style}` : "Inferred from style"].filter(Boolean));
  push("warmth", "Warmth", warmth, "emotional",
    [map.tone_preference ? `Tone: ${map.tone_preference}` : "Inferred from tone preference"].filter(Boolean));
  push("technical_depth", "Technical depth", technicalDepth, "cognitive",
    [map.technical_level ? `Level: ${map.technical_level}` : "Inferred from vocabulary"].filter(Boolean));
  push("brevity", "Brevity preference", brevity, "communication",
    [map.response_length ? `Prefers ${map.response_length} replies` : "Inferred from message length"].filter(Boolean));
  push("openness", "Emotional openness", openness, "emotional",
    ["Willingness to discuss personal or reflective topics"]);

  const radar: RadarAxis[] = [
    { axis: "Social", value: clamp((sociability + talkativeness) / 2) },
    { axis: "Calm", value: calmness },
    { axis: "Patient", value: patience },
    { axis: "Direct", value: directness },
    { axis: "Warm", value: warmth },
    { axis: "Technical", value: technicalDepth },
    { axis: "Sensitive", value: sensitivity },
    { axis: "Open", value: openness },
  ];

  const topics = extractTopics(map, corpus);
  const problemDomains = extractProblemDomains(map, corpus);
  const emotionalTags = extractEmotionalTags(map, corpus);

  const narrative = buildNarrative(map, traits, topics, problemDomains);

  return { traits, radar, narrative, topics, problemDomains, emotionalTags };
}

function evidenceFor(map: Record<string, string>, key: string, fallback: string): string[] {
  const v = map[key];
  if (v && v !== "—") return [`Stored: ${v}`];
  return fallback ? [fallback] : [];
}

function extractTopics(map: Record<string, string>, corpus: string): string[] {
  const topics = new Set<string>();
  for (const key of ["preferred_topics", "interests", "projects", "project", "goals"]) {
    const v = map[key];
    if (v && v !== "—") {
      v.split(/[,;·]/).map(t => t.trim()).filter(Boolean).forEach(t => topics.add(t));
    }
  }
  const topicHints = ["securemind", "architecture", "code", "art", "design", "health", "work", "blog"];
  for (const hint of topicHints) {
    if (corpus.includes(hint)) topics.add(hint.charAt(0).toUpperCase() + hint.slice(1));
  }
  return [...topics].slice(0, 12);
}

function extractProblemDomains(map: Record<string, string>, corpus: string): string[] {
  const domains = new Set<string>();
  const stored = map.preferred_problem_types;
  if (stored && stored !== "—") {
    stored.split(/[,;]/).map(s => s.trim()).filter(Boolean).forEach(d => domains.add(d));
  }
  const hints: [RegExp, string][] = [
    [/\b(architect|infrastructure|cloud|aws|deploy)\b/i, "System architecture"],
    [/\b(code|debug|bug|implement|refactor|api)\b/i, "Engineering & debugging"],
    [/\b(design|ui|ux|layout|interface)\b/i, "Design & UX"],
    [/\b(plan|strategy|roadmap|phase)\b/i, "Planning & strategy"],
    [/\b(personal|relationship|feel|life)\b/i, "Personal reflection"],
    [/\b(learn|teach|explain|understand)\b/i, "Learning & explanation"],
    [/\b(security|privacy|pii|compliance)\b/i, "Security & privacy"],
  ];
  for (const [re, label] of hints) {
    if (re.test(corpus)) domains.add(label);
  }
  if (map.occupation && map.occupation !== "—") {
    domains.add(`${map.occupation}-related work`);
  }
  return [...domains].slice(0, 8);
}

function extractEmotionalTags(map: Record<string, string>, corpus: string): string[] {
  const tags = new Set<string>();
  if (map.emotional_tone && map.emotional_tone !== "—") {
    map.emotional_tone.split(/[,;]/).map(t => t.trim()).filter(Boolean).forEach(t => tags.add(t));
  }
  const hints: [RegExp, string][] = [
    [/\b(curious|wonder|question)\b/i, "Curious"],
    [/\b(honest|direct|frank)\b/i, "Frank"],
    [/\b(playful|fun|humor|joke)\b/i, "Playful"],
    [/\b(focused|serious|intense)\b/i, "Focused"],
    [/\b(casual|relaxed)\b/i, "Easygoing"],
    [/\b(passion|energy|enthusias)\b/i, "Energetic"],
  ];
  for (const [re, label] of hints) {
    if (re.test(corpus)) tags.add(label);
  }
  if (map.tone_preference && map.tone_preference !== "—") tags.add(map.tone_preference);
  return [...tags].slice(0, 10);
}

function buildNarrative(
  map: Record<string, string>,
  traits: PersonalityTrait[],
  topics: string[],
  domains: string[],
): string {
  const name = map.name && map.name !== "—" ? map.name : "You";
  const social = traits.find(t => t.id === "sociability");
  const talk = traits.find(t => t.id === "talkativeness");
  const calm = traits.find(t => t.id === "calmness");
  const direct = traits.find(t => t.id === "directness");

  const parts: string[] = [];
  if (social && talk) {
    parts.push(
      `${name} comes across as ${social.level.toLowerCase()}ly sociable and ${talk.level.toLowerCase()}ly talkative in conversation`,
    );
  }
  if (direct && calm) {
    parts.push(
      `with a ${direct.level.toLowerCase()} communication style and ${calm.level.toLowerCase()} emotional baseline`,
    );
  }
  if (topics.length) {
    parts.push(`and often gravitates toward ${topics.slice(0, 4).join(", ")}`);
  }
  if (domains.length) {
    parts.push(`When problem-solving, ${name.toLowerCase() === "you" ? "they" : name} tends to work through ${domains.slice(0, 3).join(", ").toLowerCase()} challenges`);
  }
  if (parts.length === 0) {
    return "Personality profile is still forming — more conversation will sharpen sociability, temperament, and topic preferences.";
  }
  return `${parts.join(". ")}.`.replace(/\.\./g, ".");
}
