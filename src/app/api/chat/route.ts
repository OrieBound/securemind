/**
 * POST /api/chat
 *
 * Streams assistant replies from Ollama (local) with graceful error handling.
 * Swap provider by updating src/lib/models/router.ts — the route stays unchanged.
 *
 * Required body: { message: string, mode: string, companionName: string, sessionId: string }
 *
 * Ollama setup (one-time):
 *   1. Install: https://ollama.com/download
 *   2. ollama pull llama3.2
 *   3. Ollama runs automatically on port 11434.
 */

import { NextRequest } from "next/server";
import { streamOllamaChat, checkOllamaModel } from "@/lib/models/ollama";
import { streamGroqChat, isGroqAvailable } from "@/lib/models/groq";
import { routeModel, buildSystemPrompt, ollamaFallbackForMode, getCostTier, DEFAULT_TIER } from "@/lib/models/router";
import { routeMessage } from "@/lib/models/route-message";
import { selectWorkingMemory } from "@/lib/tokens";
import { retrieveSemanticMemory } from "@/lib/memory";
import { db } from "@/lib/db";
import { getIdentity } from "@/lib/identity";
import { compilePersonalityPrompt, parsePersonalityConfig } from "@/lib/agents/personality-compiler";
import type { ChatMessage } from "@/lib/models/types";

// Must be nodejs — edge runtime cannot reach localhost (Ollama)
export const runtime = "nodejs";

type HistoryMessage = { role: "user" | "assistant"; content: string };

type ChatRequest = {
  message: string;
  mode?: string;
  companionName?: string;
  agentPersonality?: string;
  agentId?: string;           // used to scope semantic memory retrieval
  images?: string[];           // base64 data URLs for vision
  sessionId?: string;
  history?: HistoryMessage[];
  sessionSummary?: string;
  facts?: Record<string, string>;
  modelOverrides?: Record<string, string>; // per-mode model overrides set by the user in the UI
  /** Previous turn's complexity tier — enables thread stickiness */
  lastTier?: string | null;
};

export async function POST(req: NextRequest) {
  const { userId } = await getIdentity(req);

  let body: ChatRequest;
  try {
    body = (await req.json()) as ChatRequest;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    message,
    mode = DEFAULT_TIER,
    companionName = "Sage",
    agentPersonality = "",
    agentId,
    images = [],
    history = [],
    sessionSummary = "",
    facts = {},
    modelOverrides = {},
    lastTier = null,
  } = body;

  // Use vision-capable model when images are present
  const hasImages = images.length > 0;
  const VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";

  if (!message?.trim()) {
    return Response.json({ error: "message is required" }, { status: 422 });
  }

  // Prefer fresh compile from personalityConfig over stale client-sent string
  let resolvedPersonality = agentPersonality;
  let hasCustomPersonality = false;
  if (agentId) {
    const agent = await db.agent.findUnique({
      where: { id: agentId },
      select: { name: true, personality: true, personalityConfig: true },
    });
    if (agent) {
      hasCustomPersonality = agent.personalityConfig != null || !!agent.personality?.trim();
      const config = parsePersonalityConfig(agent.personalityConfig, agent.personality);
      resolvedPersonality = compilePersonalityPrompt(config, agent.name);
    }
  } else if (agentPersonality.trim()) {
    hasCustomPersonality = true;
  }

  const systemPromptOptions = { hasCustomPersonality };

  // Score-based routing + optional classifier for ambiguous messages + thread stickiness
  const routeDecision = await routeMessage({
    message,
    history: history.slice(-4),
    lastTier,
    fallback: mode,
    hasImages,
  });
  let activeMode = routeDecision.tier;
  const wasAutoRouted = routeDecision.wasAuto;
  const isTrivial = routeDecision.isTrivial;

  const { model: routedModel, provider: routedProvider } = routeModel("chat", activeMode);
  // Vision requests always go to Groq's multimodal model regardless of classified mode
  let model    = hasImages && isGroqAvailable() ? VISION_MODEL : routedModel;
  let provider = hasImages ? "groq" : routedProvider;
  let useGroq  = (provider === "groq" || hasImages) && isGroqAvailable();

  // Apply session-level model override set by the user in the Intel panel
  const userModelOverride = modelOverrides[activeMode];
  if (userModelOverride && !hasImages && isGroqAvailable()) {
    model    = userModelOverride;
    provider = "groq";
    useGroq  = true;
  }

  // Swift tier is already mapped to llama-3.1-8b-instant via routeModel above.
  // Overrides are intentionally bypassed for trivial messages — quality irrelevant.

  // For Ollama modes, verify the model is reachable.
  // If auto-routed to a local model that isn't available, gracefully fall back to Groq
  // rather than returning a 503 — the user didn't explicitly choose that mode.
  if (!useGroq) {
    const modelError = await checkOllamaModel(model);
    if (modelError) {
      if (wasAutoRouted && isGroqAvailable()) {
        activeMode = DEFAULT_TIER;
        const { model: fbModel, provider: fbProvider } = routeModel("chat", activeMode);
        model    = fbModel;
        provider = fbProvider;
        useGroq  = true;
      } else {
        return Response.json({ error: modelError, setupRequired: true }, { status: 503 });
      }
    }
  }

  // For models with baked-in personalities (Modelfile), only inject context —
  // never override the system prompt or the personality gets wiped out.
  const CUSTOM_MODELS = new Set(["sage-companion"]);
  const isCustomModel = CUSTOM_MODELS.has(model);

  const BEHAVIORAL_KEYS = new Set([
    "response_length", "technical_level", "communication_style",
    "preferred_topics", "tone_preference", "feedback_style",
  ]);

  const identityFacts   = Object.entries(facts).filter(([k, v]) => v && !BEHAVIORAL_KEYS.has(k));
  const behavioralFacts = Object.entries(facts).filter(([k, v]) => v &&  BEHAVIORAL_KEYS.has(k));

  // L3: Semantic memory retrieval — find past exchanges relevant to this message.
  // Runs concurrently with token budget selection; silently skips if Ollama is down.
  const [recentHistory, semanticHits] = await Promise.all([
    Promise.resolve(selectWorkingMemory(history, 2500) as ChatMessage[]),
    agentId
      ? retrieveSemanticMemory(message, agentId, userId, 5)
      : Promise.resolve([]),
  ]);

  let messages: ChatMessage[];

  if (isCustomModel || useGroq) {
    // For Groq: use the full persona prompt so the model stays in character.
    // Custom Modelfile models already have personality baked in — only inject context.
    let systemContent = isCustomModel ? "" : buildSystemPrompt(companionName, systemPromptOptions);

    // Layer in agent-specific personality on top of the mode defaults
    if (resolvedPersonality.trim()) {
      systemContent += `\n\n${resolvedPersonality.trim()}`;
    }
    if (identityFacts.length > 0) {
      systemContent += `\n\nAbout your friend (the user — this is NOT your life, job, or hobbies; use only to understand them, never claim as yours): ${identityFacts.map(([k, v]) => `${k}: ${v}`).join(", ")}`;
    }
    if (sessionSummary.trim()) {
      systemContent += `\n\nPrevious context: ${sessionSummary}`;
    }
    // L3: inject semantic hits — things the agent said in past sessions that are relevant right now
    if (semanticHits.length > 0) {
      systemContent += `\n\nRelevant past exchanges (draw on these naturally without citing them):\n` +
        semanticHits.map(h => `- ${h.content}`).join("\n");
    }

    // Build user message — vision array format when images are attached
    const userContent = hasImages
      ? [
          { type: "text" as const, text: message || "What's in this image?" },
          ...images.map(url => ({ type: "image_url" as const, image_url: { url } })),
        ]
      : message;

    messages = systemContent.trim()
      ? [
          { role: "system", content: systemContent },
          ...recentHistory,
          { role: "user", content: userContent },
        ]
      : [
          ...recentHistory,
          { role: "user", content: userContent },
        ];
  } else {
    // Standard models: build full personality + context system prompt
    let systemPrompt = buildSystemPrompt(companionName, systemPromptOptions);
    // Inject custom agent personality if defined
    if (resolvedPersonality.trim()) {
      systemPrompt += `\n\n${resolvedPersonality.trim()}`;
    }

    if (identityFacts.length > 0) {
      const lines = identityFacts.map(([k, v]) => `- ${k}: ${v}`).join("\n");
      systemPrompt += `\n\nAbout your friend (the user — NOT your life; never claim these projects/interests as yours):\n${lines}`;
    }
    if (behavioralFacts.length > 0) {
      const lines = behavioralFacts.map(([k, v]) => `- ${k}: ${v}`).join("\n");
      systemPrompt += `\n\nHow your friend prefers to talk (adapt to them silently):\n${lines}`;
    }
    if (sessionSummary.trim()) {
      systemPrompt += `\n\nConversation so far:\n${sessionSummary}`;
    }
    if (semanticHits.length > 0) {
      systemPrompt += `\n\nRelevant past exchanges (draw on these naturally without citing them):\n` +
        semanticHits.map(h => `- ${h.content}`).join("\n");
    }

    const userContent = hasImages
      ? [
          { type: "text" as const, text: message || "What's in this image?" },
          ...images.map(url => ({ type: "image_url" as const, image_url: { url } })),
        ]
      : message;

    messages = [
      { role: "system", content: systemPrompt },
      ...recentHistory,
      { role: "user", content: userContent },
    ];
  }

  // Stream response as SSE
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Emit routing metadata first so the client knows provider + model
        // before the first token arrives.
        const actualProvider = useGroq ? "groq" : "ollama";
        const routeMeta = {
          route: {
            provider: actualProvider,
            model,
            mode: activeMode,
            isVision: hasImages,
            wasAutoRouted,
            costTier: getCostTier(actualProvider, model),
          },
        };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(routeMeta)}\n\n`));

        const emit = (delta: string) =>
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta })}\n\n`));

        let usageData: { promptTokens: number; completionTokens: number } | null = null;

        if (useGroq) {
          try {
            for await (const delta of streamGroqChat(messages, model, (u) => { usageData = u; })) {
              emit(delta);
            }
          } catch (groqErr) {
            const msg = groqErr instanceof Error ? groqErr.message : String(groqErr);
            console.warn(`[chat] Groq failed (${msg.slice(0, 80)}). Falling back to Ollama.`);
            const fallbackModel = ollamaFallbackForMode(activeMode);
            const fallbackCheck = await checkOllamaModel(fallbackModel);
            if (fallbackCheck) {
              throw new Error("Groq is unavailable and Ollama isn't running. Start Ollama or check your GROQ_API_KEY.");
            }
            for await (const delta of streamOllamaChat(messages, fallbackModel)) {
              emit(delta);
            }
          }
        } else {
          for await (const delta of streamOllamaChat(messages, model)) {
            emit(delta);
          }
        }

        // Emit exact token usage before DONE so the client can compute real costs
        if (usageData) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ usage: usageData })}\n\n`));
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (err) {
        const raw = err instanceof Error ? err.message : String(err);
        // Strip HTTP status codes and raw JSON from user-visible messages
        const clean = raw.startsWith("40") || raw.startsWith("50")
          ? "Connection issue — check your GROQ_API_KEY or make sure Ollama is running."
          : raw;
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ error: clean })}\n\n`),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
