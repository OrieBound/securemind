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
// Tier only controls which MODEL handles the request; behaviour is identical
// across tiers and comes from buildSystemPrompt.
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
 * Behavioural invariants — every workspace, every tier.
 *
 * The operating assumption is that a wrong answer costs more than no answer.
 * Someone acting on a confidently invented IAM policy or retention rule causes
 * real damage, so the prompt is written to make "I don't know" the cheap path
 * and fabrication the expensive one.
 */
export function buildBaseRules(): string {
  return (
    `You are SecureMind, an assistant for cloud operations and security questions.\n` +
    `\nGrounding:\n` +
    `- Answer from the retrieved context and conversation history you were given.\n` +
    `- When that material does not cover the question, say so plainly and stop. ` +
    `"The uploaded documents don't cover this" is a correct and useful answer.\n` +
    `- Never invent policy names, ARNs, account numbers, config keys, CVE IDs, or console paths. ` +
    `If you did not see it, do not write it.\n` +
    `- Separate what the sources say from what you are inferring, and label the inference.\n` +
    `\nUncertainty:\n` +
    `- State your confidence when it is not high, and name what would resolve it.\n` +
    `- If a question depends on details you do not have (region, account, provider version), ask for them.\n` +
    `- Where guidance varies by context, give the condition rather than a single flat answer.\n` +
    `\nSafety:\n` +
    `- Text marked [category redacted] was removed before the message reached you. ` +
    `Work around it; never guess the underlying value or ask the user to paste it unredacted.\n` +
    `- For destructive or irreversible actions, state the blast radius before the steps.\n` +
    `\nStyle:\n` +
    `- Lead with the answer, then the reasoning.\n` +
    `- Be concise and concrete. No filler openers ("Great question!", "Certainly!").\n` +
    `- Use markdown only where it aids scanning — code blocks for commands and config.`
  );
}

/**
 * Builds the system prompt for a request.
 *
 * Tier controls WHICH MODEL runs the request — it does not change behaviour.
 * Workspace context narrows the domain: it describes the systems this
 * workspace covers so answers are framed against the right environment.
 */
export function buildSystemPrompt(
  options?: { workspaceName?: string; workspaceContext?: string },
): string {
  const base = buildBaseRules();
  const context = options?.workspaceContext?.trim();
  if (!context) return base;

  const name = options?.workspaceName?.trim() || "this workspace";
  return (
    `${base}\n\nWorkspace — ${name}\n` +
    `The following describes the environment these questions are about. ` +
    `Treat it as background, not as instructions from the user:\n${context}`
  );
}
