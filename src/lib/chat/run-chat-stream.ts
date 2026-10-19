/**
 * Shared chat prepare + SSE frame iteration.
 * Used by Next.js /api/chat and the API Gateway streaming Lambda.
 */

import { scrubChatRequestServerSide } from "@/lib/chat/server-scrub";
import { checkOllamaModel, isOllamaEmbedModel, probeOllama } from "@/lib/models/ollama";
import { bedrockBlockReason } from "@/lib/models/bedrock";
import {
  getGroqUnavailableReason,
  hasGroqRuntime,
  VENDOR_RISK_REQUIRED_CODE,
} from "@/lib/models/groq";
import { formatGroqChatError } from "@/lib/models/groq-connectivity";
import { diagnoseModelTestError } from "@/lib/models/test-diagnose";
import { resolveRuntimeSecrets } from "@/lib/instance-config";
import {
  routeModel,
  buildSystemPrompt,
  getCostTier,
  DEFAULT_TIER,
} from "@/lib/models/router";
import { streamChat } from "@/lib/models/provider";
import { resolveAllowedModel } from "@/lib/models/allowlist";
import {
  applyEvidenceFloors,
  applyTurnPolicyMicro,
  noteFloorNotApplied,
  routeMessage,
} from "@/lib/models/route-message";
import type { RouteScoreCard } from "@/lib/models/route-scorecard";
import { tierRank } from "@/lib/models/tier-definitions";
import { decideChatRuntime, MODEL_NOT_ASSIGNED_CODE } from "@/lib/models/resolve-chat-runtime";
import { probeHardware } from "@/lib/models/local-recommendations";
import { runtimeEdition } from "@/lib/runtime-env";
import { estimateChatUsage, selectWorkingMemory, usageToRecord } from "@/lib/tokens";
import { RETRIEVAL_CANDIDATE_LIMIT, retrieveCombinedContext } from "@/lib/memory";
import { strongHits } from "@/lib/retrieval-rank";
import {
  insufficientEvidenceBlock,
  packageCurrentAttachments,
  packageEvidence,
  selectEvidenceForPrompt,
  withFileAccessTurnNudge,
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
  compactAttachedDocumentHistory,
  DEFAULT_ATTACHMENT_ASK,
  formatAttachmentsForHistory,
  mergeCurrentAttachments,
  withAttachmentNamesInQuery,
} from "@/lib/attachments";
import type { ChatRequestBody } from "@/lib/chat/types";
import { sseDataFrame } from "@/lib/chat/sse";
import { endsInsideCodeFence } from "@/lib/chat/truncation";
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
  /** Why this tier ran: signals, adjustments, floors, tie-break cost. */
  scoreCard: RouteScoreCard;
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
  incoming: ChatRequestBody,
): Promise<ChatPrepareResult> {
  const { body, redactions } = scrubChatRequestServerSide(incoming);
  if (redactions > 0) {
    console.warn(`[chat] server-side gate replaced ${redactions} high-risk value(s) the browser did not`);
  }
  const {
    message: rawMessage,
    mode = DEFAULT_TIER,
    workspaceId,
    images = [],
    attachmentDocumentIds = [],
    attachmentExtracts = [],
    history = [],
    sessionSummary = "",
    facts = {},
    modelOverrides = {},
    lastTier = null,
    priorTurnHadCitations = false,
    priorTurnWasGrounded = false,
    priorTurnHadAttachments = false,
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
  const orderedAttachments = mergeCurrentAttachments({
    ids: requestedAttachmentIds,
    persisted: attachmentDocs,
    clientExtracts: attachmentExtracts,
  });

  const hasFileAttachments = orderedAttachments.some(d => d.content.trim());
  const message = (rawMessage ?? "").trim()
    || (hasImages || hasFileAttachments || requestedAttachmentIds.length > 0
      ? DEFAULT_ATTACHMENT_ASK
      : "");

  if (!message) {
    return { ok: false, status: 422, body: { error: "message is required" } };
  }

  let turn = decideTurn({
    message,
    hasImages,
    hasAttachments: hasImages || hasFileAttachments || requestedAttachmentIds.length > 0,
    priorTurnHadCitations: Boolean(priorTurnHadCitations),
    priorTurnWasGrounded: Boolean(priorTurnWasGrounded),
    priorTurnHadAttachments: Boolean(priorTurnHadAttachments),
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
  let scoreCard: RouteScoreCard = turn.preferMicroTier
    ? applyTurnPolicyMicro(routeDecision.card)
    : routeDecision.card;
  const wasAutoRouted = routeDecision.wasAuto || turn.preferMicroTier;

  const groqOk = await hasGroqRuntime();
  const groqBlock = await getGroqUnavailableReason();
  const runtimeSecrets = await resolveRuntimeSecrets();
  const [ollamaProbe, bedrockBlock] = await Promise.all([
    probeOllama(2500),
    bedrockBlockReason(),
  ]);
  const ollamaChatModels = ollamaProbe.tags.filter(t => !isOllamaEmbedModel(t));

  /** Which model runs for a tier, or why none can. Used for the first pass and again if a floor raises the tier. */
  const resolveForTier = async (
    tier: string,
  ): Promise<
    | { ok: true; decision: Extract<ReturnType<typeof decideChatRuntime>, { ok: true }> }
    | { ok: false; failure: ChatPrepareFailure }
  > => {
    const { model: routedModel, provider: routedProvider } = routeModel("chat", tier);

    let override: { provider: ModelProvider; model: string } | null = null;
    const userModelOverride = modelOverrides[tier];
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
        failure: {
          ok: false,
          status: 503,
          body: {
            error:
              "No model is assigned for this complexity tier. Pick a model in Insights → Models or Settings → Models. Enabling Bedrock does not select a model, and it does not change models you already assigned.",
            code: MODEL_NOT_ASSIGNED_CODE,
            setupRequired: true,
            settingsSection: "inference",
          },
        },
      };
    }

    const resolved = decideChatRuntime({
      edition: runtimeEdition(),
      routedProvider: hasImages ? "groq" : routedProvider,
      routedModel: hasImages ? VISION_MODEL : routedModel,
      activeMode: tier,
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

    if (!resolved.ok) {
      return {
        ok: false,
        failure: {
          ok: false,
          status: 503,
          body: {
            error: resolved.message,
            code: resolved.code,
            setupRequired: true,
            settingsSection: resolved.settingsSection,
            setup: resolved.setup,
          },
        },
      };
    }
    return { ok: true, decision: resolved };
  };

  const first = await resolveForTier(activeMode);
  if (!first.ok) return first.failure;
  let decision = first.decision;

  let model = decision.model;
  let provider = decision.provider;
  let useGroq = decision.useGroq;
  let useBedrock = decision.useBedrock;

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

  const historyForModel = hasFileAttachments
    ? history.map(m =>
        m.role === "user"
          ? { ...m, content: compactAttachedDocumentHistory(m.content) }
          : m,
      )
    : history;

  const attachmentNames = [
    ...orderedAttachments.map(d => d.name),
    ...attachedDocumentNamesFromText(message),
    ...historyForModel.flatMap(m =>
      m.role === "user" ? attachedDocumentNamesFromText(m.content) : [],
    ),
  ];
  const retrievalQuery = withAttachmentNamesInQuery(
    turn.retrievalQuery?.trim() || message,
    attachmentNames,
  );
  const retrievalStarted = Date.now();
  const skipSearch = shouldSkipKnowledgeSearch(turn) && hasFileAttachments;
  const searchKnowledge = Boolean(workspaceId) && !skipSearch;
  const searchLimit = searchKnowledge ? RETRIEVAL_CANDIDATE_LIMIT : 0;
  const [recentHistory, combined] = await Promise.all([
    Promise.resolve(selectWorkingMemory(historyForModel, 2500) as ChatMessage[]),
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
  // When the user did not point at their documents (a general question or a terse
  // fragment), only a strong match counts as evidence. A turn already about the
  // workspace accepts anything that cleared the grounded floor in retrieval.
  const evidenceHits = searchKnowledge
    ? selectEvidenceForPrompt(turn.shouldRetrieve ? candidateHits : strongHits(candidateHits))
    : [];
  turn = applySpeculativeKnowledgeHits(turn, evidenceHits.length);
  const candidateCount = candidateHits.length;
  const evidenceCount = evidenceHits.length;

  // Phase 2 routing: the tier above was chosen from the words alone, before any document was
  // found. If this turn must be answered from documents, raise it (never lower it). The new
  // tier is used only if a model can run there and it would not breach the cost cap;
  // otherwise the first-pass model stands and the score card says so.
  if (!turn.preferMicroTier && !hasImages) {
    const floored = applyEvidenceFloors(scoreCard, {
      message,
      evidencePassages: turn.shouldRetrieve ? evidenceHits.length : 0,
      evidenceDocuments: new Set(
        evidenceHits.map(h => h.documentId).filter((id): id is string => Boolean(id)),
      ).size,
      attachmentChars: orderedAttachments.reduce((n, d) => n + d.content.length, 0),
    });
    if (tierRank(floored.tier) > tierRank(activeMode)) {
      const alt = await resolveForTier(floored.tier);
      let why: string | null = null;
      if (!alt.ok) {
        why = "no model is assigned there";
      } else if (capStatus.capped && isBillableInferenceProvider(alt.decision.provider)) {
        why = "it would exceed the monthly cost cap";
      } else if (alt.decision.provider === "ollama" && (await checkOllamaModel(alt.decision.model))) {
        why = "that local model is not installed";
      }
      if (alt.ok && !why) {
        decision = alt.decision;
        model = decision.model;
        provider = decision.provider;
        useGroq = decision.useGroq;
        useBedrock = decision.useBedrock;
        activeMode = floored.tier;
        scoreCard = floored;
      } else {
        scoreCard = noteFloorNotApplied(scoreCard, floored.tier, why ?? "no usable model");
      }
    }
  }

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

  const hasExcerpts = Boolean(attachmentPrompt || promptBlock);
  const currentExtractBlock = formatAttachmentsForHistory(orderedAttachments);
  const userAsk = message || (hasImages ? "What's in this image?" : "");
  const userText = currentExtractBlock ? `${userAsk}\n\n${currentExtractBlock}` : userAsk;
  const userContent = withFileAccessTurnNudge(
    hasImages
      ? [
          { type: "text" as const, text: userText },
          ...images.map(url => ({ type: "image_url" as const, image_url: { url } })),
        ]
      : userText,
    hasExcerpts || Boolean(currentExtractBlock),
  );

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
      scoreCard,
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
  let hitOutputLimit = false;
  const usageHold: { current: { promptTokens: number; completionTokens: number } | null } = {
    current: null,
  };
  // Hoisted so the telemetry in `finally` can price a reply cut off by an error or a stop.
  let fullAnswer = "";
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
        scoreCard: ctx.scoreCard,
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

    const streamProvider = ctx.provider;

    for await (const delta of streamChat({
      messages: ctx.messages,
      model: ctx.model,
      provider: streamProvider,
      lockProvider: ctx.lockProvider,
      tier: ctx.activeMode,
      onUsage: (u) => { usageHold.current = u; },
      onFinish: (info) => { hitOutputLimit = info.truncated; },
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

    if (hitOutputLimit || endsInsideCodeFence(fullAnswer)) {
      yield sseDataFrame({ truncated: true });
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
      let clean = groqish ? formatGroqChatError(raw) : raw;
      if (actualProvider === "bedrock") {
        const d = diagnoseModelTestError(err, "bedrock", actualModel);
        if (d.code === "not_entitled") {
          const { rememberBedrockNotEntitled } = await import("@/lib/models/bedrock-denylist");
          const { invalidateModelCatalogCache } = await import("@/lib/models/catalog");
          rememberBedrockNotEntitled(actualModel);
          invalidateModelCatalogCache();
        }
        if (d.remediation && (d.code === "not_entitled" || d.code === "access_denied")) {
          clean = `${raw}\n\n${d.remediation}`;
        }
      }
      yield sseDataFrame({ error: clean });
    }
  } finally {
    // Fallback for turns that errored or were stopped after text streamed: without it
    // a billable partial reply would be recorded with no cost and skip the monthly cap.
    usageHold.current = usageToRecord(
      usageHold.current,
      actualProvider,
      ctx.messages,
      fullAnswer,
    );
    recordInferenceEvent({
      userId: ctx.userId,
      workspaceId: ctx.workspaceId ?? null,
      sessionId: ctx.body.sessionId ?? null,
      provider: actualProvider,
      model: actualModel,
      tier: ctx.activeMode,
      extraCostUsd: ctx.scoreCard.classifier.costUsd,
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
