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
import { checkOllamaModel } from "@/lib/models/ollama";
import { isGroqAvailable } from "@/lib/models/groq";
import { routeModel, buildSystemPrompt, getCostTier, DEFAULT_TIER } from "@/lib/models/router";
import { streamChat } from "@/lib/models/provider";
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
import { getIdentity, IdentityError } from "@/lib/identity";
import { recordInferenceEvent } from "@/lib/analytics/write";
import type { GroundingStatus } from "@/lib/analytics/types";
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
  let userId: string;
  try {
    ({ userId } = await getIdentity(req));
  } catch (err) {
    if (err instanceof IdentityError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

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
  let provider = hasImages ? "groq" as const : routedProvider;
  let useGroq  = (provider === "groq" || hasImages) && isGroqAvailable();
  const useBedrock = provider === "bedrock";

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
  if (!useGroq && !useBedrock) {
    const modelError = await checkOllamaModel(model);
    if (modelError) {
      if (wasAutoRouted && isGroqAvailable()) {
        activeMode = DEFAULT_TIER;
        const { model: fbModel, provider: fbProvider } = routeModel("chat", activeMode);
        model    = fbModel;
        provider = fbProvider;
        useGroq  = provider === "groq";
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
      const startedAt = Date.now();
      const actualProvider = useBedrock ? "bedrock" : useGroq ? "groq" : "ollama";
      const usageHold: { current: { promptTokens: number; completionTokens: number } | null } = {
        current: null,
      };
      let groundingStatus: GroundingStatus | null = null;
      let status: "ok" | "error" | "aborted" = "ok";

      try {
        // Emit routing metadata first so the client knows provider + model
        // before the first token arrives.
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
          groundingStatus = "declined";
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

        const streamProvider = useBedrock
          ? "bedrock" as const
          : useGroq
            ? "groq" as const
            : "ollama" as const;
        for await (const delta of streamChat({
          messages,
          model,
          provider: streamProvider,
          tier: activeMode,
          onUsage: (u) => { usageHold.current = u; },
        })) {
          emit(delta);
        }

        // Deterministic citation coverage check against the evidence package.
        if (citations.length > 0 && fullAnswer.trim()) {
          const citationAudit = auditCitations(
            fullAnswer,
            citations.map(c => c.index),
          );
          groundingStatus = citationAudit.status as GroundingStatus;
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ citationAudit })}\n\n`),
          );
        } else if (!groundingStatus) {
          groundingStatus = citations.length > 0 ? "uncited" : "n/a";
        }

        // Emit exact token usage before DONE so the client can compute real costs
        if (usageHold.current) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ usage: usageHold.current })}\n\n`));
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      } catch (err) {
        status = "error";
        const raw = err instanceof Error ? err.message : String(err);
        // Strip HTTP status codes and raw JSON from user-visible messages
        const clean = raw.startsWith("40") || raw.startsWith("50")
          ? "Connection issue — check your GROQ_API_KEY or make sure Ollama is running."
          : raw;
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ error: clean })}\n\n`),
        );
      } finally {
        recordInferenceEvent({
          userId,
          workspaceId: workspaceId ?? null,
          sessionId: body.sessionId ?? null,
          provider: actualProvider,
          model,
          tier: activeMode,
          promptTokens: usageHold.current?.promptTokens ?? null,
          completionTokens: usageHold.current?.completionTokens ?? null,
          latencyMs: Date.now() - startedAt,
          status,
          retrievalHitCount: citations.length,
          citationCount: citations.length,
          groundingStatus,
        }).catch(err =>
          console.warn("[chat] inference telemetry failed (non-critical):", String(err)),
        );
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
