/**
 * Groq provider — cloud inference at very high speed.
 * Used for all complexity tiers; model selection is driven by router.ts.
 *
 * Key models (June 2026):
 *   moonshotai/kimi-k2-instruct-0905      — Max tier, most capable ($1.00/$3.00)
 *   llama-3.3-70b-versatile               — High tier, deep reasoning ($0.59/$0.79)
 *   qwen/qwen3-32b                         — Plus tier, hybrid thinking ($0.29/$0.59)
 *   openai/gpt-oss-120b                   — Standard tier, solid default ($0.15/$0.60)
 *   llama-4-scout-17b-16e-instruct        — Light tier, fast + multimodal ($0.11/$0.34)
 *   openai/gpt-oss-20b                    — Fast tier ($0.075/$0.30)
 *   llama-3.1-8b-instant                  — Micro tier, cheapest ($0.05/$0.08)
 *
 * NOTE: llama-4-maverick deprecated by Groq 2026-03-09, replaced by gpt-oss-120b.
 */

import Groq from "groq-sdk";
import type { ChatMessage } from "./types";

let _groq: Groq | null = null;

function getClient(): Groq {
  if (!_groq) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error("GROQ_API_KEY is not set in environment variables.");
    _groq = new Groq({ apiKey });
  }
  return _groq;
}

export type GroqUsage = { promptTokens: number; completionTokens: number };

export async function* streamGroqChat(
  messages: ChatMessage[],
  model: string,
  onUsage?: (usage: GroqUsage) => void,
): AsyncGenerator<string> {
  const client = getClient();

  // Groq accepts content as string or array — pass through as-is
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const formattedMessages = messages.map(m => ({ role: m.role, content: m.content as any }));

  type GroqStreamChunk = {
    choices: Array<{ delta?: { content?: string | null } }>;
    usage?: { prompt_tokens: number; completion_tokens: number };
  };

  // stream_options supported by Groq API; groq-sdk types may lag behind
  const stream = await client.chat.completions.create({
    model,
    messages: formattedMessages,
    stream: true,
    stream_options: { include_usage: true },
    temperature: 0.8,
    max_tokens: 1024,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any) as unknown as AsyncIterable<GroqStreamChunk>;

  // Think-token filter: some reasoning models (Qwen3, DeepSeek R1) output
  // <think>...</think> blocks before their answer. Strip them so only the
  // final response reaches the client.
  let pending = "";
  let inThink  = false;

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content ?? "";
    const usage = chunk.usage;

    // Capture token usage from the final chunk
    if (usage && onUsage) {
      onUsage({ promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens });
    }

    pending += delta;

    // Process the buffer, yielding safe content and discarding think blocks
    let out = "";
    while (pending.length > 0) {
      if (!inThink) {
        const si = pending.indexOf("<think>");
        if (si === -1) {
          // No opening tag — yield all but last 7 chars (partial-tag guard)
          const keep = Math.min(pending.length, 7);
          out    += pending.slice(0, pending.length - keep);
          pending = pending.slice(pending.length - keep);
          break;
        }
        out    += pending.slice(0, si);   // safe content before <think>
        pending = pending.slice(si + 7);  // skip <think>
        inThink = true;
      } else {
        const ei = pending.indexOf("</think>");
        if (ei === -1) { pending = ""; break; }  // still inside — discard
        pending = pending.slice(ei + 8);          // skip </think>
        inThink = false;
      }
    }

    if (out) yield out;
  }

  // Flush any remaining safe content after the stream ends
  if (pending && !inThink) yield pending;
}

export function isGroqAvailable(): boolean {
  return !!process.env.GROQ_API_KEY;
}

/** Pattern pass — Micro only for true one-liners; real conversation floors at Standard. */
export function heuristicComplexityTier(
  message: string,
  recentHistory: { role: "user" | "assistant"; content: string }[] = [],
): string | null {
  const m = message.trim();
  const lower = m.toLowerCase();
  const len = m.length;

  const recentText = recentHistory.slice(-2).map(h => h.content).join(" ").toLowerCase();
  const inDeepThread = /\b(debug|architect|implement|refactor|code|api|deploy|async)\b/.test(recentText);

  // ── Upper tiers first (never under-tier hard problems) ──

  // Plus — planning, synthesis (between Standard and High)
  if (/\b(help me plan|best approach|think through|walk me through|pros and cons|strategy|roadmap|brainstorm|weigh (the )?options)\b/i.test(lower)) {
    return "Plus";
  }
  if (/\b(compare|evaluate).{0,40}(options|approaches|trade-?offs|paths)\b/i.test(lower)) return "Plus";
  if (/\b(what should i|how should i|advice on|help me decide)\b/i.test(lower) && len > 60) return "Plus";

  // High — technical depth
  if (/\b(debug|refactor|implement|architecture|stack trace|race condition|code review|design a system)\b/i.test(lower) && len > 50) {
    return "High";
  }
  if (/(```|[{}();]|=>|function\s|async\s|await\s)/.test(m) && len > 40) return "High";
  if (inDeepThread && len < 140) return "High";

  // Max — explicit deep analysis (rare; classifier usually better but catch obvious cases)
  if (/\b(analyze thoroughly|design a (full|complete) system|doctoral|prove that|formal proof)\b/i.test(lower)) {
    return "Max";
  }

  // ── Lower tiers — Micro for acks only; casual chat → Standard ──

  // Light — simple how-to / explain (longer than a one-liner; 8B can mumble steps)
  if (/^(how do i|how to|what is|what's an? |explain |give me an example|can you explain|walk me through how)/i.test(lower) && len >= 45 && len < 320) {
    return "Light";
  }

  // Micro — one-word / one-line acks only (cheapest; quality irrelevant)
  if (/^(thanks|thank you|ok|okay|got it|cool|yes|no|sure|lol|haha|yep|nice|bye)\b/i.test(lower) && len < 60) {
    return "Micro";
  }
  if (/^(hey|hi|hello)\b/i.test(lower) && len < 40) {
    return "Micro";
  }

  // Fast — quick factual lookups (still cheap, noticeably better than 8B)
  if (/\b(when was|who is|who was|capital of|how many|what year|define )\b/i.test(lower) && len < 140) {
    return "Fast";
  }

  // Standard — casual companion chat, small talk, short general messages
  if (/\b(how are you|what's up|how's it going|what do you (like|do)|what else|tell me about|what do you think)\b/i.test(lower) && len < 200) {
    return "Standard";
  }
  if (len <= 200 && !/\b(analyze|design|architect|implement|debug|compare|plan|explain|help me)\b/i.test(lower)) {
    return "Standard";
  }

  return null;
}

/**
 * Classifies a user message into the appropriate complexity tier.
 *
 * Tiers (most → least complex):
 *   Apex      — deepest multi-step reasoning, architecture, graduate-level analysis
 *   Deep      — strong reasoning, code review, technical analysis, comparisons
 *   Sharp     — above-average: planning, nuanced explanations, creative depth
 *   Standard  — DEFAULT: general conversation, moderate questions, follow-ups
 *   Efficient — clear direct questions, straightforward how-to, simple explanations
 *   Quick     — simple factual lookups, short answers expected
 *   Swift     — greetings, acknowledgments, one-liners ("thanks", "ok", "got it")
 *
 * Context-aware: accepts recent history so follow-up questions stay at the same
 * tier as the preceding exchange (a follow-up to a deep technical discussion
 * should not drop to Swift just because the follow-up message is short).
 *
 * Uses llama-3.1-8b-instant at temperature 0 — near-instant, negligible cost.
 * Returns fallback tier unchanged if classification fails or Groq is unavailable.
 */
export async function classifyComplexity(
  message: string,
  fallback: string,
  recentHistory: { role: "user" | "assistant"; content: string }[] = [],
): Promise<{ mode: string; wasAuto: boolean }> {
  const heuristic = heuristicComplexityTier(message, recentHistory);
  if (heuristic) return { mode: heuristic, wasAuto: true };
  return classifyComplexityLlm(message, fallback, recentHistory);
}

/** LLM-only tier pick — used when score-based routing is ambiguous. */
export async function classifyComplexityLlm(
  message: string,
  fallback: string,
  recentHistory: { role: "user" | "assistant"; content: string }[] = [],
): Promise<{ mode: string; wasAuto: boolean }> {
  if (!isGroqAvailable()) return { mode: fallback, wasAuto: false };
  try {
    const client = getClient();

    const contextLines = recentHistory
      .slice(-4)
      .map(m => `${m.role === "user" ? "User" : "AI"}: ${String(m.content).slice(0, 120)}`)
      .join("\n");
    const contextBlock = contextLines
      ? `\nRecent conversation (for context — classify the LATEST message):\n${contextLines}\n`
      : "";

    const res = await client.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        {
          role: "system",
          content: `Pick ONE complexity tier for the LATEST user message. Reply with ONLY the tier name.
${contextBlock}
Tiers (most → least complex):
Max      — system design, deep multi-step analysis, formal proofs, "design a system"
High     — debugging, code review, complex technical "why does X", code blocks
Plus     — planning, strategy, comparing options, "help me think through", decision advice
Standard — DEFAULT for companion chat, emotional topics, small talk, general back-and-forth
Light    — ONLY simple how-to / explain (45+ chars) where step clarity matters — not casual chat
Fast     — quick factual lookups ("who is", "capital of") — not conversation
Micro    — ONLY one-line acks ("thanks", "ok", "got it", "lol") — never real conversation

RULES:
1. Casual companion chat → Standard (NOT Micro). Micro is acks only.
2. Light is for how-to/explain only — not small talk.
3. Use Plus for planning / decision-help — not Standard or High unless technical.
4. Short follow-ups in a deep technical thread → High (not Micro).
5. Escalate to Max only for genuinely deep analysis requests.`,
        },
        { role: "user", content: message.slice(0, 600) },
      ],
      max_tokens: 10,
      temperature: 0,
    });
    const raw = (res.choices[0]?.message?.content ?? "").trim();
    const VALID = ["Max", "High", "Plus", "Standard", "Light", "Fast", "Micro"];
    const found = VALID.find(t => raw.startsWith(t));
    const mode = found ?? fallback;
    return { mode, wasAuto: mode !== fallback };
  } catch {
    return { mode: fallback, wasAuto: false };
  }
}
