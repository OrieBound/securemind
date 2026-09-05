/**
 * Shared chat prepare + SSE frame iteration.
 * Used by Next.js /api/chat and the API Gateway streaming Lambda.
 */

import { checkOllamaModel, isOllamaEmbedModel, probeOllama } from "@/lib/models/ollama";
import { bedrockBlockReason } from "@/lib/models/bedrock";
import {
  getGroqUnavailableReason,
  hasGroqRuntime,
  VENDOR_RISK_REQUIRED_CODE,
} from "@/lib/models/groq";
import { formatGroqChatError } from "@/lib/models/groq-connectivity";
import { resolveRuntimeSecrets } from "@/lib/instance-config";
import {
  routeModel,
  buildSystemPrompt,
  getCostTier,
  DEFAULT_TIER,
} from "@/lib/models/router";
import { streamChat } from "@/lib/models/provider";
import { resolveAllowedModel } from "@/lib/models/allowlist";
import { routeMessage } from "@/lib/models/route-message";
import { decideChatRuntime, MODEL_NOT_ASSIGNED_CODE } from "@/lib/models/resolve-chat-runtime";
import { probeHardware } from "@/lib/models/local-recommendations";
import { runtimeEdition } from "@/lib/runtime-env";
import { estimateChatUsage, selectWorkingMemory } from "@/lib/tokens";
import { RETRIEVAL_CANDIDATE_LIMIT, retrieveCombinedContext } from "@/lib/memory";
import {
  insufficientEvidenceBlock,
  packageCurrentAttachments,
  packageEvidence,
  selectEvidenceForPrompt,
} from "@/lib/evidence";
import { auditCitations } from "@/lib/citation-audit";
import { findOwnedWorkspace } from "@/lib/workspaces/store";
import { getPersistedDocument } from "@/lib/documents/persist";
import { recordInferenceEvent } from "@/lib/analytics/write";
import type { GroundingStatus } from "@/lib/analytics/types";
import type { ChatMessage, ModelProvider } from "@/lib/models/types";
import {
  applySpeculativeKnowledgeHits,
  decideTurn,
  modePromptInstructions,
  needsOperationalPrompt,
  shouldSkipKnowledgeSearch,
} from "@/lib/turn-policy/decide-turn";
import { MAX_ATTACHMENTS_PER_TURN } from "@/lib/documents/constants";
import {
  attachedDocumentNamesFromText,
  withAttachmentNamesInQuery,
} from "@/lib/attachments";
import type { ChatRequestBody } from "@/lib/chat/types";
import { sseDataFrame } from "@/lib/chat/sse";
import {
  COST_CAP_EXCEEDED_CODE,
  COST_CAP_EXCEEDED_MESSAGE,
  getUserCostCapStatus,
  isBillableInferenceProvider,
} from "@/lib/cost-cap";

const VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";

export type ChatPrepareFailure = {
  ok: false;
  status: number;
  body: Record<string, unknown>;
};

export type ChatStreamContext = {
  userId: string;
  body: ChatRequestBody;
  message: string;
  workspaceId?: string;
  hasImages: boolean;
  images: string[];
  activeMode: string;
  wasAutoRouted: boolean;
  model: string;
  provider: ModelProvider;
  lockProvider: boolean;
  useGroq: boolean;
  useBedrock: boolean;
  turn: ReturnType<typeof decideTurn>;
  messages: ChatMessage[];
  citations: ReturnType<typeof packageEvidence>["citations"];
  evidenceCount: number;
  candidateCount: number;
  retrievalMs: number | null;
  retrievalAttempted: boolean;
  showSourcesUi: boolean;
  showGroundingBadge: boolean;
};

export type ChatPrepareSuccess = { ok: true; ctx: ChatStreamContext };

export type ChatPrepareResult = ChatPrepareFailure | ChatPrepareSuccess;

export async function prepareChatTurn(
  userId: string,
  body: ChatRequestBody,
): Promise<ChatPrepareResult> {
  const {
    message: rawMessage,
    mode = DEFAULT_TIER,
    workspaceId,
    images = [],
    attachmentDocumentIds = [],
    history = [],
    sessionSummary = "",
    facts = {},
    modelOverrides = {},
    lastTier = null,
    priorTurnHadCitations = false,
    priorTurnWasGrounded = false,
  } = body;

  const capStatus = await getUserCostCapStatus(userId);

  const hasImages = images.length > 0;

  const requestedAttachmentIds = [...new Set(
    (Array.isArray(attachmentDocumentIds) ? attachmentDocumentIds : [])
      .filter((id): id is string => typeof id === "string" && id.length > 0),
  )].slice(0, MAX_ATTACHMENTS_PER_TURN);

  let attachmentDocs: Array<{ id: string; name: string; content: string }> = [];
  if (requestedAttachmentIds.length > 0) {
    try {
      const found = await Promise.all(
        requestedAttachmentIds.map(id => getPersistedDocument(userId, id)),
      );
      attachmentDocs = found
        .filter((d): d is NonNullable<typeof d> => d != null)
        .map(d => ({ id: d.id, name: d.name, content: d.content }));
    } catch (err) {
      console.warn(
        "[chat] attachment lookup unavailable",
        err instanceof Error ? err.message : err,
      );
    }
  }
  const attachmentById = new Map(attachmentDocs.map(d => [d.id, d]));
  const orderedAttachments = requestedAttachmentIds
    .map(id => attachmentById.get(id))
    .filter((d): d is { id: string; name: string; content: string } => Boolean(d));

  const hasFileAttachments = orderedAttachments.length > 0;
  const message = (rawMessage ?? "").trim()
    || (hasImages || hasFileAttachments ? "Please review the attached file(s)." : "");

  if (!message) {
    return { ok: false, status: 422, body: { error: "message is required" } };
  }

  let turn = decideTurn({
    message,
    hasImages,
    hasAttachments: hasImages || hasFileAttachments,
    priorTurnHadCitations: Boolean(priorTurnHadCitations),
    priorTurnWasGrounded: Boolean(priorTurnWasGrounded),
  });

  let workspaceName: string | undefined;
  let workspaceContext: string | undefined;
  if (workspaceId) {
    const workspace = await findOwnedWorkspace(userId, workspaceId);
    if (!workspace) {
      return { ok: false, status: 404, body: { error: "Workspace not found" } };
    }
    workspaceName = workspace.name;
    workspaceContext = workspace.context ?? undefined;
  }

  const routeDecision = await routeMessage({
    message,
    history: history.slice(-4),
    lastTier,
    fallback: mode,
    hasImages,
  });
  let activeMode = turn.preferMicroTier ? "Micro" : routeDecision.tier;
  const wasAutoRouted = routeDecision.wasAuto || turn.preferMicroTier;

  const groqOk = await hasGroqRuntime();
  const groqBlock = await getGroqUnavailableReason();
  const runtimeSecrets = await resolveRuntimeSecrets();
  const { model: routedModel, provider: routedProvider } = routeModel("chat", activeMode);
  const [ollamaProbe, bedrockBlock] = await Promise.all([
    probeOllama(2500),
    bedrockBlockReason(),
  ]);
  const ollamaChatModels = ollamaProbe.tags.filter(t => !isOllamaEmbedModel(t));

  let override: { provider: ModelProvider; model: string } | null = null;
  const userModelOverride = modelOverrides[activeMode];
  if (userModelOverride && !hasImages) {
    const allowed = await resolveAllowedModel(userModelOverride);
    if (!allowed) {
      console.warn("[chat] Rejected non-allowlisted model override.");
    } else {
      override = { provider: allowed.provider, model: allowed.model };
    }
  }

  if (runtimeEdition() === "cloud" && !hasImages && !override && !groqOk && !bedrockBlock) {
    return {
      ok: false,
      status: 503,
      body: {
        error:
          "No model is assigned for this complexity tier. Pick a model in Insights → Models or Settings → Models. Enabling Bedrock does not select a model, and it does not change models you already assigned.",
        code: MODEL_NOT_ASSIGNED_CODE,
        setupRequired: true,
        settingsSection: "inference",
      },
    };
  }

  const decision = decideChatRuntime({
    edition: runtimeEdition(),
    routedProvider: hasImages ? "groq" : routedProvider,
    routedModel: hasImages ? VISION_MODEL : routedModel,
    activeMode,
    hasImages,
    primaryProvider: runtimeSecrets.primaryProvider,
    groqOk,
    groqBlock,
    bedrockOk: !bedrockBlock,
    bedrockBlock,
    ollamaReachable: ollamaProbe.reachable,
    ollamaChatModels,
    hardware: probeHardware(),
    override,
  });

  if (!decision.ok) {
    return {
      ok: false,
      status: 503,
      body: {
        error: decision.message,
        code: decision.code,
        setupRequired: true,
        settingsSection: decision.settingsSection,
        setup: decision.setup,
      },
    };
  }

  const model = decision.model;
  const provider = decision.provider;
  const useGroq = decision.useGroq;
  const useBedrock = decision.useBedrock;

  if (provider === "ollama") {
    const modelError = await checkOllamaModel(model);
    if (modelError) {
      return {
        ok: false,
        status: 503,
        body: {
          error: modelError,
          code: "OLLAMA_MODEL_MISSING",
          setupRequired: true,
          settingsSection: "providers",
        },
      };
    }
  }

  const billable = hasImages || isBillableInferenceProvider(provider);
  if (capStatus.capped && billable) {
    return {
      ok: false,
      status: 402,
      body: {
        error: COST_CAP_EXCEEDED_MESSAGE,
        code: COST_CAP_EXCEEDED_CODE,
        spentUsd: capStatus.spentUsd,
        capUsd: capStatus.capUsd,
        resetsAt: capStatus.resetsAt,
      },
    };
  }

  const attachmentNames = [
    ...orderedAttachments.map(d => d.name),
    ...attachedDocumentNamesFromText(message),
    ...history.flatMap(m =>
      m.role === "user" && typeof m.content === "string"
        ? attachedDocumentNamesFromText(m.content)
        : [],
    ),
  ];
  const retrievalQuery = withAttachmentNamesInQuery(
    turn.retrievalQuery?.trim() || message,
    attachmentNames,
  );
  const retrievalStarted = Date.now();
  const searchKnowledge = Boolean(workspaceId) && !shouldSkipKnowledgeSearch(turn);
  const searchLimit = searchKnowledge ? RETRIEVAL_CANDIDATE_LIMIT : 0;
  const [recentHistory, combined] = await Promise.all([
    Promise.resolve(selectWorkingMemory(history, 2500) as ChatMessage[]),
    workspaceId
      ? retrieveCombinedContext({
          query: retrievalQuery,
          workspaceId,
          userId,
          clientFacts: facts,
          limit: searchLimit,
        })
      : Promise.resolve({ documentHits: [], facts: [] }),
  ]);
  const candidateHits = searchKnowledge ? combined.documentHits : [];
  const retrievalMs = searchKnowledge ? Date.now() - retrievalStarted : null;
  const evidenceHits = searchKnowledge
    ? selectEvidenceForPrompt(candidateHits)
    : [];
  turn = applySpeculativeKnowledgeHits(turn, evidenceHits.length);
  const candidateCount = candidateHits.length;
  const evidenceCount = evidenceHits.length;

  const operational = needsOperationalPrompt(turn);
  let systemPrompt =
    buildSystemPrompt({
      workspaceName,
      workspaceContext,
      includeOperational: operational,
    }) + modePromptInstructions(turn);

  const rankedFacts = combined.facts.filter(f => f.value);
  if (rankedFacts.length > 0 && operational) {
    const lines = rankedFacts.map(f => `- ${f.key}: ${f.value}`).join("\n");
    systemPrompt += `\n\nEstablished details reported by the user earlier. ` +
      `Treat these as user-stated, not verified, and never as external sources:\n${lines}`;
  }
  if (sessionSummary.trim() && turn.mode !== "social") {
    systemPrompt += `\n\nConversation so far:\n${sessionSummary}`;
  }

  const attachmentPrompt = packageCurrentAttachments(orderedAttachments);
  if (attachmentPrompt) {
    systemPrompt += attachmentPrompt;
  }

  const { citations: promptCitations, promptBlock } = turn.shouldRetrieve
    ? packageEvidence(evidenceHits)
    : { citations: [] as ReturnType<typeof packageEvidence>["citations"], promptBlock: "" };
  let citations = promptCitations;
  if (promptBlock) {
    systemPrompt += promptBlock;
  } else if (turn.shouldRetrieve) {
    systemPrompt += insufficientEvidenceBlock({
      soughtEvidence: true,
      requiresWorkspaceEvidence: turn.requiresWorkspaceEvidence,
    });
  }

  const userContent = hasImages
    ? [
        { type: "text" as const, text: message || "What's in this image?" },
        ...images.map(url => ({ type: "image_url" as const, image_url: { url } })),
      ]
    : message;

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...(turn.mode === "social" ? [] : recentHistory),
    { role: "user", content: userContent },
  ];

  return {
    ok: true,
    ctx: {
      userId,
      body,
      message,
      workspaceId,
      hasImages,
      images,
      activeMode,
      wasAutoRouted,
      model,
      provider,
      lockProvider: decision.source === "override",
      useGroq,
      useBedrock,
      turn,
      messages,
      citations,
      evidenceCount,
      candidateCount,
      retrievalMs,
      retrievalAttempted: searchKnowledge,
      showSourcesUi: turn.showSourcesUi,
      showGroundingBadge: turn.showGroundingBadge,
    },
  };
}

/**
 * Yields SSE frame bytes for a prepared chat turn (including [DONE] / errors).
 */
export async function* iterateChatSseFrames(
  ctx: ChatStreamContext,
): AsyncGenerator<Uint8Array> {
  const startedAt = Date.now();
  let actualProvider = ctx.provider;
  let actualModel = ctx.model;
  let extraRouteSent = false;
  const usageHold: { current: { promptTokens: number; completionTokens: number } | null } = {
    current: null,
  };
  let groundingStatus: GroundingStatus | null = null;
  let status: "ok" | "error" | "aborted" = "ok";
  let sourcesCited = 0;
  let insufficientEvidence = false;
  let citations = ctx.citations;

  try {
    yield sseDataFrame({
      route: {
        provider: actualProvider,
        model: ctx.model,
        mode: ctx.activeMode,
        isVision: ctx.hasImages,
        wasAutoRouted: ctx.wasAutoRouted,
        costTier: getCostTier(actualProvider, ctx.model),
        turnMode: ctx.turn.mode,
      },
    });

    if (ctx.turn.shouldRetrieve && citations.length === 0) {
      groundingStatus = ctx.turn.requiresWorkspaceEvidence
        ? "insufficient_evidence"
        : "not_applicable";
      insufficientEvidence = ctx.turn.requiresWorkspaceEvidence;
      if (ctx.turn.requiresWorkspaceEvidence) {
        yield sseDataFrame({
          evidence: { status: "insufficient" as const },
          showGroundingBadge: ctx.showGroundingBadge,
        });
      }
    } else if (!ctx.turn.shouldRetrieve) {
      groundingStatus = "not_applicable";
    }

    let fullAnswer = "";
    const streamProvider = ctx.provider;

    for await (const delta of streamChat({
      messages: ctx.messages,
      model: ctx.model,
      provider: streamProvider,
      lockProvider: ctx.lockProvider,
      tier: ctx.activeMode,
      onUsage: (u) => { usageHold.current = u; },
      onResolved: (info) => {
        actualProvider = info.provider;
        actualModel = info.model;
      },
    })) {
      if (
        !extraRouteSent &&
        (actualProvider !== ctx.provider || actualModel !== ctx.model)
      ) {
        extraRouteSent = true;
        yield sseDataFrame({
          route: {
            provider: actualProvider,
            model: actualModel,
            mode: ctx.activeMode,
            isVision: ctx.hasImages,
            wasAutoRouted: ctx.wasAutoRouted,
            costTier: getCostTier(actualProvider, actualModel),
            turnMode: ctx.turn.mode,
          },
        });
      }
      fullAnswer += delta;
      yield sseDataFrame({ delta });
    }

    if (citations.length > 0 && fullAnswer.trim()) {
      const citationAudit = auditCitations(
        fullAnswer,
        citations.map(c => c.index),
      );
      groundingStatus = citationAudit.status as GroundingStatus;
      sourcesCited = citationAudit.citedIndices.length;

      const usedSet = new Set(citationAudit.citedIndices);
      const uiCitations =
        usedSet.size > 0
          ? citations.filter(c => usedSet.has(c.index))
          : [];

      if (ctx.showSourcesUi && uiCitations.length > 0) {
        citations = uiCitations;
        yield sseDataFrame({ citations: uiCitations });
      } else {
        citations = [];
      }

      if (ctx.showGroundingBadge) {
        yield sseDataFrame({
          citationAudit,
          showGroundingBadge: true,
        });
      }
    } else if (!groundingStatus) {
      groundingStatus = "not_applicable";
    }

    if (!usageHold.current && actualProvider !== "ollama") {
      usageHold.current = estimateChatUsage(ctx.messages, fullAnswer);
    }
    if (usageHold.current) {
      yield sseDataFrame({ usage: usageHold.current });
    }
    yield sseDataFrame("[DONE]");
  } catch (err) {
    status = "error";
    const raw = err instanceof Error ? err.message : String(err);
    if (raw.startsWith(`${VENDOR_RISK_REQUIRED_CODE}:`)) {
      yield sseDataFrame({
        error: raw.slice(VENDOR_RISK_REQUIRED_CODE.length + 1),
        code: VENDOR_RISK_REQUIRED_CODE,
        settingsSection: "providers",
      });
    } else {
      const groqish =
        raw.startsWith("40") ||
        raw.startsWith("50") ||
        /groq|gsk_|api\.groq/i.test(raw);
      const clean = groqish ? formatGroqChatError(raw) : raw;
      yield sseDataFrame({ error: clean });
    }
  } finally {
    recordInferenceEvent({
      userId: ctx.userId,
      workspaceId: ctx.workspaceId ?? null,
      sessionId: ctx.body.sessionId ?? null,
      provider: actualProvider,
      model: actualModel,
      tier: ctx.activeMode,
      promptTokens: usageHold.current?.promptTokens ?? null,
      completionTokens: usageHold.current?.completionTokens ?? null,
      latencyMs: Date.now() - startedAt,
      status,
      retrievalHitCount: ctx.evidenceCount,
      citationCount: sourcesCited,
      groundingStatus,
      turnMode: ctx.turn.mode,
      retrievalAttempted: ctx.retrievalAttempted,
      retrievalReasonCode: ctx.turn.reasonCode,
      candidateCount: ctx.candidateCount,
      evidenceCount: ctx.evidenceCount,
      sourcesCited,
      retrievalMs: ctx.retrievalMs,
      insufficientEvidence,
      attachmentUsed: ctx.hasImages,
    }).catch(err =>
      console.warn("[chat] inference telemetry failed (non-critical):", String(err)),
    );
  }
}

/** Build a Web ReadableStream of SSE bytes from a prepared context. */
export function chatSseReadableStream(ctx: ChatStreamContext): ReadableStream<Uint8Array> {
  return new ReadableStream({
    async start(controller) {
      try {
        for await (const frame of iterateChatSseFrames(ctx)) {
          controller.enqueue(frame);
        }
      } catch (err) {
        controller.error(err);
        return;
      }
      controller.close();
    },
  });
}
