/**
 * Random profile generation and archetype helpers.
 */

import {
  ARCHETYPE_DEFINITIONS,
  DEFAULT_TRAITS,
  clampTrait,
  defaultPersonalityConfig,
  type ArchetypeId,
  type PersonalityConfig,
  type TraitId,
} from "./personality-types";
import { applyArchetypeBlend } from "./personality-compiler";

const TRAIT_IDS = Object.keys(DEFAULT_TRAITS) as TraitId[];

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

export function generateRandomConfig(): PersonalityConfig {
  const count = Math.random() > 0.5 ? 2 : 1;
  const shuffled = [...ARCHETYPE_DEFINITIONS].sort(() => Math.random() - 0.5);
  const picked = shuffled.slice(0, count);
  const weights = count === 1
    ? [{ id: picked[0]!.id, weight: 100 }]
    : [{ id: picked[0]!.id, weight: clampTrait(rand(45, 65)) }, { id: picked[1]!.id, weight: 0 }];

  if (count === 2) weights[1]!.weight = 100 - weights[0]!.weight;

  let config = applyArchetypeBlend(defaultPersonalityConfig(), weights);

  for (const id of TRAIT_IDS) {
    config.traits[id] = clampTrait(config.traits[id] + rand(-12, 12));
  }
  config.voice.emojiLevel = clampTrait(rand(10, 70));
  config.boundaries.sycophancy = clampTrait(rand(10, 40));
  config.traits.flirtiness = Math.random() > 0.85 ? clampTrait(rand(55, 80)) : clampTrait(rand(0, 15));

  return config;
}

export function toggleArchetype(
  config: PersonalityConfig,
  id: ArchetypeId,
): PersonalityConfig {
  const existing = config.archetypes.find(a => a.id === id);
  if (existing) {
    const next = config.archetypes.filter(a => a.id !== id);
    if (!next.length) return config;
    const even = Math.floor(100 / next.length);
    return applyArchetypeBlend(config, next.map((a, i) => ({
      id: a.id,
      weight: i === next.length - 1 ? 100 - even * (next.length - 1) : even,
    })));
  }
  const next = [...config.archetypes, { id, weight: 0 }].slice(-3);
  const even = Math.floor(100 / next.length);
  return applyArchetypeBlend(config, next.map((a, i) => ({
    id: a.id,
    weight: i === next.length - 1 ? 100 - even * (next.length - 1) : even,
  })));
}

export function isArchetypeActive(config: PersonalityConfig, id: ArchetypeId): boolean {
  return config.archetypes.some(a => a.id === id);
}
