/**
 * Privacy-preserving analytics writers.
 * Never accept or persist raw detected values, prompts, or document bodies.
 */

import { db } from "@/lib/db";
import {
  estimateTurnCostUsd,
  GROQ_PRICING_VERSION,
} from "@/lib/pricing/groq";
import {
  riskLevelForCategory,
  type GroundingStatus,
  type InferenceStatus,
  type SecurityOutcome,
  type SecuritySource,
} from "./types";

export type SecurityEventInput = {
  userId: string;
  workspaceId?: string | null;
  source: SecuritySource;
  category: string;
  outcome: SecurityOutcome;
  count?: number;
  sensitivity?: string | null;
  resourceKind?: "message" | "document" | null;
  resourceId?: string | null;
  riskLevel?: string;
  at?: Date;
};

export async function recordSecurityEvents(events: SecurityEventInput[]): Promise<number> {
  if (events.length === 0) return 0;
  const data = events.map(e => ({
    userId: e.userId,
    workspaceId: e.workspaceId ?? null,
    source: e.source,
    category: e.category,
    riskLevel: e.riskLevel ?? riskLevelForCategory(e.category),
    outcome: e.outcome,
    count: Math.max(1, e.count ?? 1),
    sensitivity: e.sensitivity ?? null,
    resourceKind: e.resourceKind ?? null,
    resourceId: e.resourceId ?? null,
    ...(e.at ? { at: e.at } : {}),
  }));
  const result = await db.securityEvent.createMany({ data });
  return result.count;
}

export type InferenceEventInput = {
  userId: string;
  workspaceId?: string | null;
  sessionId?: string | null;
  messageId?: string | null;
  provider: string;
  model: string;
  tier: string;
  promptTokens?: number | null;
  completionTokens?: number | null;
  latencyMs?: number | null;
  status: InferenceStatus;
  retrievalHitCount?: number;
  citationCount?: number;
  groundingStatus?: GroundingStatus | null;
  turnMode?: string | null;
  retrievalAttempted?: boolean;
  retrievalReasonCode?: string | null;
  candidateCount?: number;
  evidenceCount?: number;
  sourcesCited?: number;
  retrievalMs?: number | null;
  insufficientEvidence?: boolean;
  attachmentUsed?: boolean;
};

export async function recordInferenceEvent(input: InferenceEventInput): Promise<void> {
  const prompt = input.promptTokens ?? null;
  const completion = input.completionTokens ?? null;
  let estimatedCostUsd: number | null = null;
  let pricingVersion: string | null = null;
  if (prompt != null && completion != null && input.provider === "groq") {
    estimatedCostUsd = estimateTurnCostUsd(input.model, prompt, completion);
    pricingVersion = GROQ_PRICING_VERSION;
  }

  await db.inferenceEvent.create({
    data: {
      userId: input.userId,
      workspaceId: input.workspaceId ?? null,
      sessionId: input.sessionId ?? null,
      messageId: input.messageId ?? null,
      provider: input.provider,
      model: input.model,
      tier: input.tier,
      promptTokens: prompt,
      completionTokens: completion,
      latencyMs: input.latencyMs ?? null,
      status: input.status,
      retrievalHitCount: input.retrievalHitCount ?? 0,
      citationCount: input.citationCount ?? 0,
      groundingStatus: input.groundingStatus ?? null,
      estimatedCostUsd,
      pricingVersion,
      turnMode: input.turnMode ?? null,
      retrievalAttempted: input.retrievalAttempted ?? false,
      retrievalReasonCode: input.retrievalReasonCode ?? null,
      candidateCount: input.candidateCount ?? 0,
      evidenceCount: input.evidenceCount ?? 0,
      sourcesCited: input.sourcesCited ?? 0,
      retrievalMs: input.retrievalMs ?? null,
      insufficientEvidence: input.insufficientEvidence ?? false,
      attachmentUsed: input.attachmentUsed ?? false,
    },
  });
}
