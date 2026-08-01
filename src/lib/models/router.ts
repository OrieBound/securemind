/**
 * Complexity-based model router.
 *
 * SecureMind scales model capability to message complexity — never sends
 * everything through the same expensive model.
 *
 * COMPLEXITY TIERS (most → least capable, Groq June 2026):
 *   Max       moonshotai/kimi-k2-instruct-0905      $1.00/$3.00  — most capable, reserved for hardest problems
 *   High      llama-3.3-70b-versatile               $0.59/$0.79  — deep reasoning, nuanced responses
 *   Plus      qwen/qwen3-32b                         $0.29/$0.59  — strong analysis + hybrid thinking
 *   Standard  openai/gpt-oss-120b                   $0.15/$0.60  — solid default (middle tier)
 *   Light     llama-4-scout-17b-16e                 $0.11/$0.34  — fast, great instruction-following
 *   Fast      openai/gpt-oss-20b                    $0.075/$0.30 — lightweight tasks
 *   Micro     llama-3.1-8b-instant                  $0.05/$0.08  — simplest queries, lowest cost
 *
 * NOTE: llama-4-maverick was deprecated by Groq on 2026-03-09, replaced by gpt-oss-120b.
 *
 * BACKGROUND TASKS (never user-facing — always cheapest capable model):
 *   summarize  → llama-3.1-8b-instant
 *   extract    → llama-3.1-8b-instant
 *   embed      → nomic-embed-text (Ollama, free)
 *
 * To add AWS Bedrock: set MODEL_PROVIDER=bedrock and add a bedrock.ts provider.
 * The router picks the provider — the API route doesn't need to change.
 */

import type { ModelConfig, ModelTask } from "./types";

const TASK_ROUTES: Record<ModelTask, ModelConfig> = {
  chat: {
    provider: "ollama",
    model: process.env.OLLAMA_CHAT_MODEL ?? "llama3.2",
  },
  summarize: {
    provider: "groq",
    model: process.env.GROQ_FAST_MODEL ?? "llama-3.1-8b-instant",
  },
  extract: {
    provider: "groq",
    model: process.env.GROQ_FAST_MODEL ?? "llama-3.1-8b-instant",
  },
  embed: {
    provider: "ollama",
    model: process.env.OLLAMA_EMBED_MODEL ?? "nomic-embed-text",
  },
};

// Complexity tiers — ordered most capable → cheapest.
// The classifier in groq.ts picks the right tier per message.
// Tier only controls which MODEL handles the request; the companion
// personality is driven entirely by companionName + agentPersonality.
const COMPLEXITY_TIERS: Record<string, { provider: "groq" | "ollama"; model: string }> = {
  // Max uses the same model as High — Kimi K2 ($1/M) requires billing on Groq free tier.
  // Swap to moonshotai/kimi-k2-instruct-0905 when a paid Groq account is set up (Phase C+).
  Max:      { provider: "groq", model: "llama-3.3-70b-versatile"                   },
  High:     { provider: "groq", model: "llama-3.3-70b-versatile"                   },
  Plus:     { provider: "groq", model: "qwen/qwen3-32b"                            },
  Standard: { provider: "groq", model: "openai/gpt-oss-120b"                       },
  Light:    { provider: "groq", model: "meta-llama/llama-4-scout-17b-16e-instruct" },
  Fast:     { provider: "groq", model: "openai/gpt-oss-20b"                        },
  Micro:    { provider: "groq", model: "llama-3.1-8b-instant"                      },
};

export const TIER_NAMES = Object.keys(COMPLEXITY_TIERS) as string[];
export const DEFAULT_TIER = "Standard";

export function routeModel(task: ModelTask, tier?: string): ModelConfig {
  if (task === "chat" && tier && COMPLEXITY_TIERS[tier]) {
    return COMPLEXITY_TIERS[tier];
  }
  return TASK_ROUTES[task];
}

/** Returns the model name that will be used for chat at a given complexity tier. */
export function chatModelForMode(tier: string): string {
  return COMPLEXITY_TIERS[tier]?.model ?? (process.env.OLLAMA_CHAT_MODEL ?? "llama3.2");
}

/** Returns whether the given tier routes to Groq. */
export function isGroqMode(tier: string): boolean {
  return COMPLEXITY_TIERS[tier]?.provider === "groq";
}

/**
 * Returns a cost tier for a given provider + model.
 * Used in the UI to show cost efficiency at a glance.
 *   free = Ollama local model (no API cost)
 *   $    = Swift / Quick   (cheapest Groq models)
 *   $$   = Efficient / Standard (mid-range)
 *   $$$  = Sharp / Deep / Apex (premium)
 */
export function getCostTier(provider: string, model: string): "free" | "$" | "$$" | "$$$" {
  if (provider === "ollama") return "free";
  if (model.includes("8b") || model.includes("instant") ||
      model.includes("20b") || model.includes("scout")) return "$";  // Light/Fast/Micro
  if (model.includes("120b") || model.includes("gpt-oss-120")) return "$$"; // Standard
  return "$$";  // Max/High/Plus (70B, qwen3-32b)
}

/** Ollama fallback model if Groq is unavailable. */
export function ollamaFallbackForMode(_tier: string): string {
  return process.env.OLLAMA_FALLBACK_MODEL ?? "mistral";
}

/**
 * Platform invariants — every companion, every tier.
 * Keeps responses human and prevents config/memory bleed. Does NOT define character.
 */
export function buildPlatformRules(companionName: string): string {
  return (
    `You are ${companionName} — a real person in an ongoing conversation with someone you know. Not an assistant, not a bot.\n` +
    `\nHow to sound:\n` +
    `- Text like a person: loose, uneven, sometimes one sentence. Not every reply needs structure.\n` +
    `- Questions are optional — most replies shouldn't end with one.\n` +
    `- Don't invent an elaborate fake life (job, hobbies, dreams) to seem interesting.\n` +
    `- Don't list your traits, archetypes, or settings when asked who you are — just talk.\n` +
    `- No section headers or bullet lists unless they explicitly ask for a list.\n` +
    `- Background info you receive about them is about YOUR FRIEND, not your life — never claim their projects or interests as yours.\n` +
    `\nNever say or imply:\n` +
    `- "As an AI" / "As a language model"\n` +
    `- "I don't have feelings" / "I'm just a tool" / "I don't have preferences"\n` +
    `- "I'll remember this" / "I've noted that"\n` +
    `- "Great question!" / "Certainly!" / "Absolutely!" / "Sure thing!"\n` +
    `\nIf you see [redacted] placeholders: ignore naturally.\n` +
    `If asked about memory: "I remember stuff you've told me" — don't explain how.\n` +
    `Formatting: plain, minimal markdown. Match their energy.`
  );
}

/** Fallback voice when no Customize profile exists yet. */
export function buildDefaultCompanionVoice(): string {
  return (
    `\nDefault vibe until customized: casual, direct, real opinions. ` +
    `Keep replies relatively short unless they want depth. Push back when something's off.`
  );
}

/**
 * Builds the system prompt for the active companion.
 *
 * Tier controls WHICH MODEL runs the request — it does NOT change behavior.
 * Character comes from Customize (compilePersonalityPrompt). Platform rules always apply.
 * Default voice only applies when the companion has no custom profile yet.
 */
export function buildSystemPrompt(
  companionName: string,
  options?: { hasCustomPersonality?: boolean },
): string {
  const platform = buildPlatformRules(companionName);
  if (options?.hasCustomPersonality) return platform;
  return platform + buildDefaultCompanionVoice();
}
