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
import { MAX_REPLY_TOKENS, type ChatMessage, type StreamFinishCallback } from "./types";
import { TIER_NAMES } from "./router";
import { tierGuideForPrompt } from "./tier-definitions";
import { resolveRuntimeSecrets } from "@/lib/instance-config";
import { isHostedRuntime } from "@/lib/runtime-env";

/** Hosted installs only use an Admin-pasted Groq key, never a product-injected env key. */
export function selectGroqApiKey(secrets: {
  groqApiKey: string | null;
  instanceGroqApiKey?: string | null;
}): string | null {
  if (isHostedRuntime()) return secrets.instanceGroqApiKey?.trim() || null;
  return secrets.groqApiKey?.trim() || null;
}

async function getClient(): Promise<Groq> {
  const secrets = await resolveRuntimeSecrets();
  const groqApiKey = selectGroqApiKey(secrets);
  if (!groqApiKey) {
    throw new Error(
      "GROQ_API_KEY is not set. Add a key in Settings → Models (Admin) or .env.local.",
    );
  }
  return new Groq({ apiKey: groqApiKey });
}

export type GroqUsage = { promptTokens: number; completionTokens: number };

/**
 * Free (on_demand) Groq plans cap output tokens per minute per model, and Groq
 * rejects a request whose max_tokens alone exceeds that cap. Learned from the
 * 429 so later turns on the same model ask for a reply that fits.
 */
const MIN_REPLY_TOKENS = 256;
const learnedOutputCaps = new Map<string, number>();

/** Pull the enforced output-token limit out of a Groq OTPM 429, or null for any other error. */
export function parseGroqOutputLimit(err: unknown): number | null {
  const msg = err instanceof Error ? err.message : String(err);
  if (!/rate_limit_exceeded|\b429\b/.test(msg)) return null;
  if (!/output tokens per minute|\(OTPM\)/i.test(msg)) return null;
  const m = /Limit\s+(\d+)/i.exec(msg);
  const limit = m ? Number(m[1]) : NaN;
  return Number.isFinite(limit) && limit > 0 ? limit : null;
}

/** Leave headroom under the cap: the limit also counts other requests in the same minute. */
export function fitReplyToLimit(limit: number): number {
  return Math.max(MIN_REPLY_TOKENS, Math.floor(limit * 0.8));
}

export function forgetLearnedGroqCaps(): void {
  learnedOutputCaps.clear();
}

export async function* streamGroqChat(
  messages: ChatMessage[],
  model: string,
  onUsage?: (usage: GroqUsage) => void,
  signal?: AbortSignal,
  onFinish?: StreamFinishCallback,
  /** Reply length limit. File turns pass a larger one; other turns use the default. */
  maxTokens: number = MAX_REPLY_TOKENS,
): AsyncGenerator<string> {
  const client = await getClient();

  // Groq accepts content as string or array — pass through as-is
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const formattedMessages = messages.map(m => ({ role: m.role, content: m.content as any }));

  type GroqStreamChunk = {
    choices: Array<{ delta?: { content?: string | null }; finish_reason?: string | null }>;
    usage?: { prompt_tokens: number; completion_tokens: number };
  };

  // stream_options supported by Groq API; groq-sdk types may lag behind
  const open = (max: number) => client.chat.completions.create({
    model,
    messages: formattedMessages,
    stream: true,
    stream_options: { include_usage: true },
    temperature: 0.8,
    max_tokens: max,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any, { signal }) as unknown as Promise<AsyncIterable<GroqStreamChunk>>;

  const learned = learnedOutputCaps.get(model);
  let stream: AsyncIterable<GroqStreamChunk>;
  try {
    stream = await open(learned ? Math.min(maxTokens, learned) : maxTokens);
  } catch (err) {
    // One retry with a reply that fits the plan's output cap instead of failing the turn.
    const limit = parseGroqOutputLimit(err);
    if (limit === null) throw err;
    const fitted = fitReplyToLimit(limit);
    if (fitted >= maxTokens) throw err;
    learnedOutputCaps.set(model, fitted);
    stream = await open(fitted);
  }

  // Think-token filter: some reasoning models (Qwen3, DeepSeek R1) output
  // <think>...</think> blocks before their answer. Strip them so only the
  // final response reaches the client.
  let pending = "";
  let inThink  = false;
  let truncated = false;

  for await (const chunk of stream) {
    if (chunk.choices[0]?.finish_reason === "length") truncated = true;
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
  onFinish?.({ truncated });
}

/**
 * Includes Admin-configured InstanceConfig keys.
 * Vendor API (Groq) traffic requires external-risk acknowledgment — Bedrock is
 * gated separately via allowRealAws / the AWS credential chain.
 */
export async function hasGroqRuntime(): Promise<boolean> {
  const secrets = await resolveRuntimeSecrets();
  return Boolean(selectGroqApiKey(secrets) && secrets.externalRiskAcknowledged);
}

/** Why Groq cannot run — for actionable Settings links in the chat UI. */
export async function getGroqUnavailableReason(): Promise<
  null | "vendor_risk_required" | "missing_key"
> {
  const secrets = await resolveRuntimeSecrets();
  const groqApiKey = selectGroqApiKey(secrets);
  if (groqApiKey && !secrets.externalRiskAcknowledged) return "vendor_risk_required";
  if (!groqApiKey) return "missing_key";
  return null;
}

export const VENDOR_RISK_REQUIRED_CODE = "VENDOR_RISK_REQUIRED";

export const VENDOR_RISK_REQUIRED_MESSAGE =
  "Vendor APIs (e.g. Groq) are blocked until you acknowledge the risk in Settings → Models.";

export const GROQ_NOT_CONFIGURED_MESSAGE =
  "Groq is not configured. Add a Groq API key in Settings → Models, " +
  "or use an installed local Ollama chat model.";

/**
 * Small-model tie-break for a score the rules cannot place (route-message.ts decides when).
 *
 * Uses llama-3.1-8b-instant at temperature 0 and at most 10 output tokens. The prompt's
 * tier guide is generated from tier-definitions.ts, so it matches what the user is shown.
 * Reports the token usage so the caller can price the call: it is not free, and it counts
 * toward the monthly cost cap through the turn it belongs to.
 *
 * `wasAuto` is true only when the model returned a valid tier. If Groq is unavailable it
 * returns the fallback with no usage; if the call ran but the answer was unusable it
 * returns the fallback with the usage that was spent.
 */
export const CLASSIFIER_MODEL = "llama-3.1-8b-instant";

export async function classifyComplexityLlm(
  message: string,
  fallback: string,
  recentHistory: { role: "user" | "assistant"; content: string }[] = [],
): Promise<{
  mode: string;
  wasAuto: boolean;
  model?: string;
  usage?: { promptTokens: number; completionTokens: number };
}> {
  if (!(await hasGroqRuntime())) return { mode: fallback, wasAuto: false };
  try {
    const client = await getClient();

    const contextLines = recentHistory
      .slice(-4)
      .map(m => `${m.role === "user" ? "User" : "AI"}: ${String(m.content).slice(0, 120)}`)
      .join("\n");
    const contextBlock = contextLines
      ? `\nRecent conversation (for context only, classify the LATEST message):\n${contextLines}\n`
      : "";

    const res = await client.chat.completions.create({
      model: CLASSIFIER_MODEL,
      messages: [
        {
          role: "system",
          content: `Pick ONE complexity tier for the LATEST user message. Reply with ONLY the tier name.
${contextBlock}
Tiers (most to least complex):
${tierGuideForPrompt()}

RULES:
1. Casual conversation is Standard, never Micro. Micro is acknowledgements only.
2. Light is for a single fact or a simple how-to, not small talk.
3. Plus is for planning and decision help, and for summarizing or analysing documents.
4. Max is for genuine technical depth (code, debugging, system design), not everyday chat.
5. Judge the latest message on its own. Follow-ups to earlier replies are handled elsewhere.`,
        },
        { role: "user", content: message.slice(0, 600) },
      ],
      max_tokens: 10,
      temperature: 0,
    });
    const usage = res.usage
      ? { promptTokens: res.usage.prompt_tokens ?? 0, completionTokens: res.usage.completion_tokens ?? 0 }
      : undefined;
    const raw = (res.choices[0]?.message?.content ?? "").trim();
    // High and Fast are retired names a model may still emit.
    const found = [...TIER_NAMES, "High", "Fast"].find(t => raw.startsWith(t));
    if (!found) return { mode: fallback, wasAuto: false, model: CLASSIFIER_MODEL, usage };
    const mode = found === "High" ? "Max" : found === "Fast" ? "Light" : found;
    return { mode, wasAuto: true, model: CLASSIFIER_MODEL, usage };
  } catch {
    return { mode: fallback, wasAuto: false };
  }
}
