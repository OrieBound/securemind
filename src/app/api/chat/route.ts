/**
 * POST /api/chat
 *
 * Streams assistant replies over SSE, from Groq when available and Ollama
 * otherwise. Swap provider by updating src/lib/models/router.ts — the route
 * stays unchanged.
 *
 * Required body: { message: string, workspaceId: string, sessionId: string }
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
import {
  insufficientEvidenceBlock,
  messageNeedsEvidence,
  packageEvidence,
} from "@/lib/evidence";
import { auditCitations } from "@/lib/citation-audit";
import { db } from "@/lib/db";
import { getIdentity } from "@/lib/identity";
import type { ChatMessage } from "@/lib/models/types";

// Must be nodejs — edge runtime cannot reach localhost (Ollama)
export const runtime = "nodejs";

type HistoryMessage = { role: "user" | "assistant"; content: string };

type ChatRequest = {
  message: string;
  mode?: string;
  workspaceId?: string;        // scopes prompt context and semantic retrieval
  images?: string[];           // base64 data URLs for vision
  sessionId?: string;
  history?: HistoryMessage[];
  sessionSummary?: string;
  facts?: Record<string, string>;
  modelOverrides?: Record<string, string>; // per-tier model overrides set by the user in the UI
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
    workspaceId,
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

  // The workspace record feeds the system prompt and scopes retrieval, so it
  // must be resolved through the caller's own rows — an id alone is not
  // authorization to read someone else's context.
  let workspaceName: string | undefined;
  let workspaceContext: string | undefined;
  if (workspaceId) {
    const workspace = await db.workspace.findFirst({
      where:  { id: workspaceId, userId },
      select: { name: true, context: true },
    });
    if (!workspace) {
      return Response.json({ error: "Workspace not found" }, { status: 404 });
    }
    workspaceName    = workspace.name;
    workspaceContext = workspace.context ?? undefined;
  }

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

  // L3: Semantic memory retrieval — find past exchanges and document chunks
  // relevant to this message. Runs concurrently with token budget selection;
  // silently skips if Ollama is down.
  const [recentHistory, semanticHits] = await Promise.all([
    Promise.resolve(selectWorkingMemory(history, 2500) as ChatMessage[]),
    workspaceId
      ? retrieveSemanticMemory(message, workspaceId, userId, 5)
      : Promise.resolve([]),
  ]);

  let systemPrompt = buildSystemPrompt({ workspaceName, workspaceContext });

  const knownFacts = Object.entries(facts).filter(([, v]) => v);
  if (knownFacts.length > 0) {
    const lines = knownFacts.map(([k, v]) => `- ${k}: ${v}`).join("\n");
    systemPrompt += `\n\nEstablished details for this workspace, from earlier conversation. ` +
      `Treat these as reported by the user rather than verified:\n${lines}`;
  }
  if (sessionSummary.trim()) {
    systemPrompt += `\n\nConversation so far:\n${sessionSummary}`;
  }
  // Numbered evidence for citations; when empty, push insufficient-evidence
  // language so fabrication is the expensive path for ops questions.
  const { citations, promptBlock } = packageEvidence(semanticHits);
  if (promptBlock) {
    systemPrompt += promptBlock;
  } else {
    systemPrompt += insufficientEvidenceBlock(
      messageNeedsEvidence(message, { isTrivial }),
    );
  }

  // Vision array format when images are attached.
  const userContent = hasImages
    ? [
        { type: "text" as const, text: message || "What's in this image?" },
        ...images.map(url => ({ type: "image_url" as const, image_url: { url } })),
      ]
    : message;

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...recentHistory,
    { role: "user", content: userContent },
  ];

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

        if (citations.length > 0) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ citations })}\n\n`),
          );
        } else if (messageNeedsEvidence(message, { isTrivial })) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ evidence: { status: "insufficient" as const } })}\n\n`,
            ),
          );
        }

        let fullAnswer = "";
        const emit = (delta: string) => {
          fullAnswer += delta;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta })}\n\n`));
        };

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

        // Deterministic citation coverage check against the evidence package.
        if (citations.length > 0 && fullAnswer.trim()) {
          const citationAudit = auditCitations(
            fullAnswer,
            citations.map(c => c.index),
          );
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ citationAudit })}\n\n`),
          );
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
