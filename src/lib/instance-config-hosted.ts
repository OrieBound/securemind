/**
 * Hosted InstanceConfig on the fragments table (no Postgres).
 * Vendor API keys are not stored here — Parameter Store holds them
 * (`VENDOR_KEYS_PARAM`). This row is non-secret settings only.
 */

import type { AttributeValue } from "@aws-sdk/client-dynamodb";
import { ATTR } from "@/lib/storage/dynamodb-schema";
import {
  createDynamoDriver,
  createMemoryDriver,
  type HostedDriver,
} from "@/lib/workspaces/hosted-dynamo";
import type { InstanceConfigRow } from "@/lib/instance-config";
import { parseVoiceSttChoice } from "@/lib/transcribe/backend";

const PK = "app#instance";
const SK = "cfg#singleton";
const CATEGORY = "instance_config";

type Stored = {
  id: string;
  primaryProvider: string;
  groqApiKey: string | null;
  awsProfile: string | null;
  allowRealAws: boolean;
  bedrockRegion: string | null;
  bedrockChatModel: string | null;
  extraProviderKeys: unknown;
  externalRiskAckAt: string | null;
  piiSensitivity: string;
  safeTerms: unknown;
  pendingPiiSensitivity: string | null;
  pendingSafeTerms: unknown;
  pendingProposedByUserId: string | null;
  pendingProposedAt: string | null;
  pendingNote: string | null;
  defaultMonthlyCostCapUsd: number;
  ownerUserId: string | null;
  setupCompletedAt: string | null;
  setupClaimUsedAt: string | null;
  storageBackend: string | null;
  voiceSttChoice: string | null;
  voiceSttAudioAckAt: string | null;
  portalName?: string | null;
  portalTagline?: string | null;
  portalLogoAt?: string | null;
  pricingRateOverrides?: unknown;
  modelAvailability?: unknown;
  taskModels?: unknown;
  updatedAt: string;
  updatedByUserId: string | null;
};

function iso(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  return d instanceof Date ? d.toISOString() : d;
}

function asDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Missing key means "never set" (default phrase). Empty string hides the line. */
function storedPortalTagline(raw: Stored): string | null {
  if (!Object.prototype.hasOwnProperty.call(raw, "portalTagline") || raw.portalTagline == null) {
    return null;
  }
  return typeof raw.portalTagline === "string" ? raw.portalTagline : null;
}

export function emptyInstanceConfigRow(): InstanceConfigRow {
  return {
    id: "singleton",
    primaryProvider: "auto",
    groqApiKey: null,
    awsProfile: null,
    allowRealAws: false,
    bedrockRegion: null,
    bedrockChatModel: null,
    extraProviderKeys: null,
    externalRiskAckAt: null,
    piiSensitivity: "balanced",
    safeTerms: null,
    pendingPiiSensitivity: null,
    pendingSafeTerms: null,
    pendingProposedByUserId: null,
    pendingProposedAt: null,
    pendingNote: null,
    defaultMonthlyCostCapUsd: 10,
    ownerUserId: null,
    setupCompletedAt: null,
    setupClaimUsedAt: null,
    storageBackend: "dynamodb",
    voiceSttChoice: null,
    voiceSttAudioAckAt: null,
    portalName: null,
    portalTagline: null,
    portalLogoAt: null,
    pricingRateOverrides: null,
    updatedAt: new Date(),
    updatedByUserId: null,
  };
}

function toStored(row: InstanceConfigRow): Stored {
  return {
    id: row.id,
    primaryProvider: row.primaryProvider,
    groqApiKey: null,
    awsProfile: row.awsProfile,
    allowRealAws: Boolean(row.allowRealAws),
    bedrockRegion: row.bedrockRegion,
    bedrockChatModel: row.bedrockChatModel,
    extraProviderKeys: null,
    externalRiskAckAt: iso(row.externalRiskAckAt),
    piiSensitivity: row.piiSensitivity,
    safeTerms: row.safeTerms,
    pendingPiiSensitivity: row.pendingPiiSensitivity,
    pendingSafeTerms: row.pendingSafeTerms,
    pendingProposedByUserId: row.pendingProposedByUserId,
    pendingProposedAt: iso(row.pendingProposedAt),
    pendingNote: row.pendingNote,
    defaultMonthlyCostCapUsd: row.defaultMonthlyCostCapUsd,
    ownerUserId: row.ownerUserId,
    setupCompletedAt: iso(row.setupCompletedAt),
    setupClaimUsedAt: iso(row.setupClaimUsedAt),
    storageBackend: row.storageBackend,
    voiceSttChoice: row.voiceSttChoice,
    voiceSttAudioAckAt: iso(row.voiceSttAudioAckAt),
    portalName: row.portalName,
    portalTagline: row.portalTagline,
    portalLogoAt: iso(row.portalLogoAt),
    pricingRateOverrides: row.pricingRateOverrides ?? null,
    modelAvailability: row.modelAvailability ?? null,
    taskModels: row.taskModels ?? null,
    updatedAt: iso(row.updatedAt) ?? new Date().toISOString(),
    updatedByUserId: row.updatedByUserId,
  };
}

function fromStored(raw: Stored): InstanceConfigRow {
  return {
    id: raw.id || "singleton",
    primaryProvider: raw.primaryProvider || "auto",
    groqApiKey: raw.groqApiKey,
    awsProfile: raw.awsProfile,
    allowRealAws: Boolean(raw.allowRealAws),
    bedrockRegion: raw.bedrockRegion,
    bedrockChatModel: raw.bedrockChatModel,
    extraProviderKeys: raw.extraProviderKeys,
    externalRiskAckAt: asDate(raw.externalRiskAckAt),
    piiSensitivity: raw.piiSensitivity || "balanced",
    safeTerms: raw.safeTerms,
    pendingPiiSensitivity: raw.pendingPiiSensitivity,
    pendingSafeTerms: raw.pendingSafeTerms,
    pendingProposedByUserId: raw.pendingProposedByUserId,
    pendingProposedAt: asDate(raw.pendingProposedAt),
    pendingNote: raw.pendingNote,
    defaultMonthlyCostCapUsd:
      typeof raw.defaultMonthlyCostCapUsd === "number" ? raw.defaultMonthlyCostCapUsd : 10,
    ownerUserId: raw.ownerUserId,
    setupCompletedAt: asDate(raw.setupCompletedAt),
    setupClaimUsedAt: asDate(raw.setupClaimUsedAt),
    storageBackend: raw.storageBackend,
    voiceSttChoice: parseVoiceSttChoice(raw.voiceSttChoice),
    voiceSttAudioAckAt: asDate(raw.voiceSttAudioAckAt),
    portalName: typeof raw.portalName === "string" && raw.portalName.trim() ? raw.portalName : null,
    portalTagline: storedPortalTagline(raw),
    portalLogoAt: asDate(raw.portalLogoAt),
    pricingRateOverrides: raw.pricingRateOverrides ?? null,
    modelAvailability: raw.modelAvailability ?? null,
    taskModels: raw.taskModels ?? null,
    updatedAt: asDate(raw.updatedAt) ?? new Date(),
    updatedByUserId: raw.updatedByUserId,
  };
}

function parseStored(item: Record<string, AttributeValue> | null): InstanceConfigRow | null {
  const json = item?.[ATTR.content]?.S;
  if (!json) return null;
  try {
    return fromStored(JSON.parse(json) as Stored);
  } catch {
    return null;
  }
}

export function createHostedInstanceConfigStore(driver: HostedDriver) {
  async function get(): Promise<InstanceConfigRow | null> {
    const item = await driver.get(PK, SK);
    return parseStored(item);
  }

  async function put(row: InstanceConfigRow): Promise<void> {
    const stored = toStored({ ...row, id: "singleton", updatedAt: new Date() });
    await driver.put(PK, SK, {
      [ATTR.userId]: { S: "instance" },
      [ATTR.category]: { S: CATEGORY },
      [ATTR.content]: { S: JSON.stringify(stored) },
    });
  }

  async function ensure(): Promise<InstanceConfigRow> {
    const existing = await get();
    if (existing) return existing;
    const created = emptyInstanceConfigRow();
    await put(created);
    return created;
  }

  async function merge(partial: Record<string, unknown>): Promise<InstanceConfigRow> {
    const current = await ensure();
    const next: InstanceConfigRow = {
      ...current,
      ...partial,
      id: "singleton",
      updatedAt: new Date(),
    } as InstanceConfigRow;
    await put(next);
    return next;
  }

  /** One-time lock for the first-run claim. True for exactly one caller. */
  async function reserveClaim(): Promise<boolean> {
    return driver.putIfAbsent(PK, "claim#lock", {
      [ATTR.userId]: { S: "instance" },
      [ATTR.category]: { S: CATEGORY },
      [ATTR.content]: { S: JSON.stringify({ at: new Date().toISOString() }) },
    });
  }

  async function releaseClaim(): Promise<void> {
    await driver.delete(PK, "claim#lock");
  }

  return { get, put, ensure, merge, reserveClaim, releaseClaim };
}

export type HostedInstanceConfigStore = ReturnType<typeof createHostedInstanceConfigStore>;

let singleton: HostedInstanceConfigStore | null = null;

export function hostedInstanceConfig(): HostedInstanceConfigStore {
  singleton ??= createHostedInstanceConfigStore(createDynamoDriver());
  return singleton;
}

/** Tests only. */
export function resetHostedInstanceConfigForTests(driver?: HostedDriver): HostedInstanceConfigStore {
  singleton = createHostedInstanceConfigStore(driver ?? createMemoryDriver());
  return singleton;
}
