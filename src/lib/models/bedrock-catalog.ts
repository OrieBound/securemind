/**
 * Pure Bedrock catalog selection — no AWS SDK.
 *
 * ListFoundationModels returns every TEXT model in the region, including
 * retired aliases. The picker should only offer what ConverseStream can
 * actually call, derived from those **list** responses: ACTIVE models, and
 * inference-profile ids when those exist. No invoke, no per-model probe.
 */

import {
  isChatUsableModelId,
  isBedrockRestrictedAccessId,
  BEDROCK_ENABLE_IN_CONSOLE_NOTE,
  type CatalogModel,
} from "./catalog-shared";

export type BedrockFoundationSummary = {
  modelId?: string;
  modelArn?: string;
  modelName?: string;
  providerName?: string;
  responseStreamingSupported?: boolean;
  inferenceTypesSupported?: string[];
  modelLifecycle?: { status?: string };
};

export type BedrockInferenceProfile = {
  inferenceProfileId?: string;
  inferenceProfileName?: string;
  status?: string;
  type?: string;
  models?: Array<{ modelArn?: string }>;
};

export type BedrockAvailability = {
  authorizationStatus?: string;
  entitlementAvailability?: string;
  regionAvailability?: string;
  agreementStatus?: string;
};

export type BedrockCatalogCandidate = {
  model: CatalogModel;
  foundationModelId: string;
};

export function foundationModelIdFromArn(arn: string): string | null {
  const marker = "foundation-model/";
  const i = arn.indexOf(marker);
  if (i === -1) return null;
  const id = arn.slice(i + marker.length).trim();
  return id || null;
}

/**
 * Ready = this account can invoke it.
 * Needs enablement = listed for the region, but Model catalog / agreement is off.
 * Omit = retired, wrong region, or IAM-blocked — never show.
 */
export function classifyBedrockAccess(
  a: BedrockAvailability | "unknown" | undefined,
): "ready" | "needs_enablement" | "omit" {
  if (!a || a === "unknown") return "ready";
  if (a.regionAvailability === "NOT_AVAILABLE") return "omit";
  if (a.authorizationStatus === "NOT_AUTHORIZED") return "omit";
  if (a.agreementStatus === "PENDING" || a.agreementStatus === "NOT_AVAILABLE") {
    return "needs_enablement";
  }
  if (a.entitlementAvailability === "NOT_AVAILABLE") return "needs_enablement";
  return "ready";
}

/** True when Bedrock says this account can use the foundation model in-region. */
export function isBedrockModelAvailable(a: BedrockAvailability): boolean {
  return classifyBedrockAccess(a) === "ready";
}

export function applyBedrockAvailability(
  candidates: BedrockCatalogCandidate[],
  availabilityByFoundationId: Map<string, BedrockAvailability | "unknown">,
): CatalogModel[] {
  const models: CatalogModel[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    if (seen.has(c.model.id)) continue;
    if (
      isBedrockRestrictedAccessId(c.model.id)
      || isBedrockRestrictedAccessId(c.foundationModelId)
    ) {
      continue;
    }
    const probed = availabilityByFoundationId.get(c.foundationModelId);
    const kind = classifyBedrockAccess(probed);
    if (kind === "omit") continue;
    seen.add(c.model.id);
    if (kind === "needs_enablement") {
      models.push({
        ...c.model,
        access: "needs_enablement",
        note: BEDROCK_ENABLE_IN_CONSOLE_NOTE,
      });
    } else {
      models.push(c.model);
    }
  }
  return models.sort((a, b) => a.name.localeCompare(b.name));
}

export function uniqueFoundationModelIds(candidates: BedrockCatalogCandidate[]): string[] {
  return [...new Set(candidates.map(c => c.foundationModelId).filter(Boolean))].sort();
}

/**
 * Prefer inference-profile ids (`us.*`, `global.*`) over raw ON_DEMAND ids.
 * `anthropic.claude-sonnet-5` is listed as on-demand but fails at invoke;
 * `us.anthropic.claude-sonnet-4-5-…` is the id that actually works.
 */
export function selectInvocableBedrockModels(
  summaries: BedrockFoundationSummary[],
  profiles: BedrockInferenceProfile[],
): BedrockCatalogCandidate[] {
  const profileIdsByFoundationArn = new Map<string, string[]>();
  const usedProfileIds = new Set<string>();

  for (const p of profiles) {
    if (!p.inferenceProfileId) continue;
    if (p.status && p.status !== "ACTIVE") continue;
    if (p.type && p.type !== "SYSTEM_DEFINED") continue;
    if (!isChatUsableModelId(p.inferenceProfileId)) continue;
    for (const m of p.models ?? []) {
      if (!m.modelArn) continue;
      const list = profileIdsByFoundationArn.get(m.modelArn) ?? [];
      if (!list.includes(p.inferenceProfileId)) list.push(p.inferenceProfileId);
      profileIdsByFoundationArn.set(m.modelArn, list);
    }
  }

  const candidates: BedrockCatalogCandidate[] = [];
  const seen = new Set<string>();

  const push = (id: string, name: string, note: string | undefined, foundationModelId: string) => {
    if (seen.has(id) || !isChatUsableModelId(id) || !isChatUsableModelId(name)) return;
    seen.add(id);
    candidates.push({
      foundationModelId,
      model: {
        id,
        name,
        provider: "bedrock",
        modality: "text",
        ...(note ? { note } : {}),
      },
    });
  };

  for (const m of summaries) {
    if (!m.modelId || !m.responseStreamingSupported) continue;
    if ((m.modelLifecycle?.status ?? "ACTIVE") !== "ACTIVE") continue;

    const displayName = m.modelName
      ? `${m.providerName ?? ""} ${m.modelName}`.trim()
      : m.modelId;
    const types: string[] = m.inferenceTypesSupported ?? [];
    const viaProfiles = m.modelArn ? profileIdsByFoundationArn.get(m.modelArn) ?? [] : [];
    const foundationId = (m.modelArn ? foundationModelIdFromArn(m.modelArn) : null) ?? m.modelId;

    if (viaProfiles.length > 0) {
      for (const profileId of viaProfiles) {
        usedProfileIds.add(profileId);
        push(profileId, displayName, "Cross-region inference profile", foundationId);
      }
      continue;
    }

    if (types.includes("ON_DEMAND")) {
      push(m.modelId, displayName, undefined, m.modelId);
    }
  }

  for (const p of profiles) {
    if (!p.inferenceProfileId || usedProfileIds.has(p.inferenceProfileId)) continue;
    if (p.status && p.status !== "ACTIVE") continue;
    if (p.type && p.type !== "SYSTEM_DEFINED") continue;
    if (!isChatUsableModelId(p.inferenceProfileId)) continue;
    const foundationId =
      p.models?.map(m => (m.modelArn ? foundationModelIdFromArn(m.modelArn) : null)).find(Boolean)
      ?? p.inferenceProfileId.replace(/^(us|eu|apac|global)\./, "");
    const name = p.inferenceProfileName?.trim() || p.inferenceProfileId;
    push(p.inferenceProfileId, name, "Cross-region inference profile", foundationId);
  }

  return candidates;
}
