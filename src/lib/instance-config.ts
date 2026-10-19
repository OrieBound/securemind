/**
 * Instance-level provider settings (singleton row).
 * Admin writes; runtime readers overlay env defaults.
 *
 * AWS credentials are deliberately absent from this store. They come from the
 * deployment environment via `src/lib/aws-credentials.ts` — never from the UI,
 * never from the database.
 */

import { db } from "@/lib/db";
import { isHostedRuntime, runtimeDeployment, runtimeEdition } from "@/lib/runtime-env";
import { hostedInstanceConfig } from "@/lib/instance-config-hosted";
import type { WizardStorageChoice } from "@/lib/wizard-storage";
import { decryptSecret, encryptSecret } from "@/lib/secret-at-rest";
import {
  readVendorKeyBundle,
  writeVendorKeyBundle,
  type VendorExtraKey,
} from "@/lib/vendor-key-store";
import {
  detectProviderKey,
  kindDisplayName,
  type DetectedKeyKind,
} from "@/lib/provider-key-detect";
import {
  canUseBedrock,
  getAwsCredentialStatus,
  resetAwsCredentialCache,
  type AwsCredentialStatus,
} from "@/lib/aws-credentials";
import { invalidateModelCatalogCache } from "@/lib/models/catalog";
import { catalogKindForDetectedKind, isWiredVendorKind } from "@/lib/vendor-providers";
import {
  parseVoiceSttChoice,
  type VoiceSttChoice,
} from "@/lib/transcribe/backend";

export type PrimaryProvider = "auto" | "groq" | "bedrock" | "ollama";

export type InstanceConfigRow = {
  id: string;
  primaryProvider: string;
  groqApiKey: string | null;
  awsProfile: string | null;
  allowRealAws: boolean;
  bedrockRegion: string | null;
  bedrockChatModel: string | null;
  extraProviderKeys: unknown;
  externalRiskAckAt: Date | null;
  piiSensitivity: string;
  safeTerms: unknown;
  pendingPiiSensitivity: string | null;
  pendingSafeTerms: unknown;
  pendingProposedByUserId: string | null;
  pendingProposedAt: Date | null;
  pendingNote: string | null;
  defaultMonthlyCostCapUsd: number;
  ownerUserId: string | null;
  setupCompletedAt: Date | null;
  setupClaimUsedAt: Date | null;
  storageBackend: string | null;
  voiceSttChoice: string | null;
  voiceSttAudioAckAt: Date | null;
  /** Sidebar portal name. Null uses the SecureMind wordmark. */
  portalName: string | null;
  /** Sidebar phrase. Null uses the default phrase. Empty string hides the line. */
  portalTagline: string | null;
  /** Set when a custom portal logo is stored. Null uses the SecureMind mark. */
  portalLogoAt: Date | null;
  /** Sparse Admin list-rate overrides. Hosted Dynamo JSON; local file. Not Prisma. */
  pricingRateOverrides?: unknown;
  modelAvailability?: unknown;
  updatedAt: Date;
  updatedByUserId: string | null;
};

/** Public (no secrets) row in the Admin keys inventory. */
export type KeyInventoryItem = {
  id: string;
  kind: DetectedKeyKind | "ollama";
  label: string;
  description: string;
  hint: string | null;
  source: "instance" | "env" | "local" | "aws-chain";
  /** ready = usable; incomplete = missing prerequisite; stored = saved, not wired */
  status: "ready" | "incomplete" | "stored" | "local";
  region?: string | null;
  /** Links this credential to a model catalog bucket. */
  catalog: "groq" | "bedrock" | "ollama" | "google" | "openai" | "anthropic" | "xai" | "none";
  /** True when SecureMind cannot edit this credential from the UI by design. */
  managedByEnvironment?: boolean;
};

export type PublicProviderStatus = {
  edition: "local" | "cloud";
  /** Where this process runs. Docker local Bedrock reads the mounted AWS CLI directory. */
  deployment: "docker" | "host" | "hosted";
  primaryProvider: PrimaryProvider;
  hasGroqKey: boolean;
  groqKeyHint: string | null;
  hasEnvGroqKey: boolean;
  bedrockRegion: string | null;
  bedrockChatModel: string | null;
  externalRiskAckAt: string | null;
  voiceSttChoice: VoiceSttChoice | null;
  voiceSttAudioAckAt: string | null;
  updatedAt: string | null;
  /** Environment-derived AWS credential status (never includes a secret). */
  aws: AwsCredentialStatus;
  /** Unified credential inventory for Settings UI. */
  keys: KeyInventoryItem[];
};

type ExtraKey = {
  id: string;
  kind: DetectedKeyKind;
  label: string;
  secret: string;
  region?: string | null;
  createdAt: string;
};

export class ProviderConfigError extends Error {
  status: number;
  constructor(message: string, status = 422) {
    super(message);
    this.name = "ProviderConfigError";
    this.status = status;
  }
}

function hint(secret: string | null | undefined): string | null {
  if (!secret || secret.length < 4) return secret ? "••••" : null;
  const last4 = secret.slice(-4);
  if (secret.startsWith("gsk_")) return `gsk_…${last4}`;
  if (secret.startsWith("sk-ant-")) return `sk-ant-…${last4}`;
  if (secret.startsWith("sk-")) return `sk-…${last4}`;
  if (secret.startsWith("AIza")) return `AIza…${last4}`;
  if (secret.startsWith("AQ.")) return `AQ.…${last4}`;
  return `…${last4}`;
}

function parseExtraKeys(raw: unknown): ExtraKey[] {
  if (!Array.isArray(raw)) return [];
  const out: ExtraKey[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    if (typeof r.id !== "string" || typeof r.secret !== "string") continue;
    const kind = (typeof r.kind === "string" ? r.kind : "unknown") as DetectedKeyKind;
    out.push({
      id: r.id,
      kind,
      label: typeof r.label === "string" ? r.label : kindDisplayName(kind),
      secret: r.secret,
      region: typeof r.region === "string" ? r.region : null,
      createdAt: typeof r.createdAt === "string" ? r.createdAt : new Date().toISOString(),
    });
  }
  return out;
}

/**
 * A stored secret that no longer decrypts (different instance key) is treated as missing, so one
 * unreadable key does not hide the rest of the row or block the Admin from saving a new one.
 */
function tryDecrypt(value: string | null | undefined): string | null {
  try {
    return decryptSecret(value);
  } catch {
    console.warn("[instance-config] a stored vendor key could not be decrypted with the current instance key");
    return null;
  }
}

function decryptConfigRow(row: InstanceConfigRow): InstanceConfigRow {
  const extras = parseExtraKeys(row.extraProviderKeys)
    .map(k => ({ ...k, secret: tryDecrypt(k.secret) ?? "" }))
    .filter(k => k.secret !== "");
  return {
    ...row,
    groqApiKey: tryDecrypt(row.groqApiKey),
    extraProviderKeys: extras,
  };
}

export async function getInstanceConfig(): Promise<InstanceConfigRow | null> {
  if (isHostedRuntime()) {
    try {
      const row = await hostedInstanceConfig().get();
      if (!row) return null;
      const decrypted = decryptConfigRow(row);
      const bundle = await readVendorKeyBundle();
      const leftoverExtras = parseExtraKeys(decrypted.extraProviderKeys);
      const leftoverGroq = decrypted.groqApiKey?.trim() || null;
      const leftoverHas = Boolean(leftoverGroq) || leftoverExtras.length > 0;
      const smEmpty = !bundle.groqApiKey && bundle.extra.length === 0;
      let keys = bundle;
      if (smEmpty && leftoverHas) {
        try {
          await writeVendorKeyBundle({
            groqApiKey: leftoverGroq,
            extra: leftoverExtras as VendorExtraKey[],
          });
          keys = { groqApiKey: leftoverGroq, extra: leftoverExtras };
          await hostedInstanceConfig().merge({ groqApiKey: null, extraProviderKeys: null });
        } catch {
          keys = { groqApiKey: leftoverGroq, extra: leftoverExtras };
        }
      } else {
        if (row.groqApiKey || row.extraProviderKeys) {
          await hostedInstanceConfig().merge({ groqApiKey: null, extraProviderKeys: null });
        }
      }
      return {
        ...decrypted,
        groqApiKey: keys.groqApiKey,
        extraProviderKeys: keys.extra,
      };
    } catch {
      return null;
    }
  }
  try {
    const row = await db.instanceConfig.findUnique({ where: { id: "singleton" } });
    return row ? decryptConfigRow(row) : null;
  } catch {
    return null;
  }
}

export async function ensureInstanceConfig(): Promise<InstanceConfigRow> {
  const existing = await getInstanceConfig();
  if (existing) return existing;
  if (isHostedRuntime()) {
    const row = await hostedInstanceConfig().ensure();
    return (await getInstanceConfig()) ?? decryptConfigRow(row);
  }
  const row = await db.instanceConfig.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", primaryProvider: "auto" },
    update: {},
  });
  return decryptConfigRow(row);
}

function bedrockInventoryItem(
  aws: AwsCredentialStatus,
  region: string | null,
): KeyInventoryItem {
  const base = {
    id: "bedrock-environment",
    kind: "bedrock" as const,
    label: "Amazon Bedrock",
    hint: aws.hint,
    source: "aws-chain" as const,
    region: region ?? aws.region,
    catalog: "bedrock" as const,
    managedByEnvironment: true,
  };

  if (aws.looksLikeFloci) {
    return {
      ...base,
      description:
        "Local sign-in placeholders are present. Bedrock needs an AWS CLI profile on this computer.",
      status: "incomplete",
    };
  }
  if (!aws.detected) {
    return {
      ...base,
      description:
        "No AWS credentials in this environment. Run `aws sso login`, set a profile, or provide AWS_* variables.",
      status: "incomplete",
    };
  }
  if (!aws.allowRealAws) {
    return {
      ...base,
      description: aws.lockedByEnvironment
        ? "Credentials found, but ALLOW_REAL_AWS=false in the environment blocks billable calls."
        : "Credentials found. Turn on billable AWS calls below to use Bedrock.",
      status: "incomplete",
    };
  }
  if (!base.region) {
    return {
      ...base,
      description: "Credentials found, but no AWS region is configured.",
      status: "incomplete",
    };
  }
  return {
    ...base,
    description: `Using ${describeSource(aws.source)} credentials from the environment.`,
    status: "ready",
  };
}

function describeSource(source: AwsCredentialStatus["source"]): string {
  switch (source) {
    case "env":
      return "environment variable";
    case "shared-profile":
      return "shared profile / SSO";
    case "container-role":
      return "container role";
    case "instance-role":
      return "instance role";
    case "web-identity":
      return "web identity";
    default:
      return "unknown";
  }
}

function buildKeyInventory(
  row: InstanceConfigRow | null,
  aws: AwsCredentialStatus,
): KeyInventoryItem[] {
  const keys: KeyInventoryItem[] = [];
  const envGroq = process.env.GROQ_API_KEY?.trim() || null;

  if (row?.groqApiKey?.trim()) {
    keys.push({
      id: "groq-instance",
      kind: "groq",
      label: "Groq",
      description: "Instance Groq API key — text models from Groq.",
      hint: hint(row.groqApiKey),
      source: "instance",
      status: "ready",
      catalog: "groq",
    });
  } else if (envGroq) {
    keys.push({
      id: "groq-env",
      kind: "groq",
      label: "Groq (.env)",
      description: "GROQ_API_KEY from server environment.",
      hint: hint(envGroq),
      source: "env",
      status: "ready",
      catalog: "groq",
      managedByEnvironment: true,
    });
  }

  keys.push(bedrockInventoryItem(aws, row?.bedrockRegion ?? null));

  keys.push({
    id: "ollama-local",
    kind: "ollama",
    label: "Ollama (local)",
    description: "No credential — Ollama models run on this machine only.",
    hint: null,
    source: "local",
    status: "local",
    catalog: "ollama",
  });

  for (const extra of parseExtraKeys(row?.extraProviderKeys)) {
    const meta = detectProviderKey(extra.secret);
    const kind = extra.kind === "unknown" ? meta.kind : extra.kind;
    const catalogBucket = catalogKindForDetectedKind(kind);
    const wired = isWiredVendorKind(kind);
    keys.push({
      id: `extra:${extra.id}`,
      kind,
      label: extra.label || meta.label,
      description: meta.description,
      hint: hint(extra.secret),
      source: "instance",
      status: wired ? "ready" : "stored",
      region: extra.region,
      catalog: catalogBucket === "none" ? "none" : catalogBucket,
    });
  }

  return keys;
}

/** App-managed AWS settings. Pointers and toggles only — never credential material. */
function awsSettingsFrom(row: InstanceConfigRow | null) {
  return {
    profile: row?.awsProfile ?? null,
    allowRealAws: Boolean(row?.allowRealAws),
    region: row?.bedrockRegion ?? null,
  };
}

/** Credential status using this instance's saved profile/region/gate. */
export async function getInstanceAwsStatus(): Promise<AwsCredentialStatus> {
  const row = await getInstanceConfig();
  return getAwsCredentialStatus(awsSettingsFrom(row));
}

/** Whether Bedrock may run, using this instance's saved settings. */
export async function instanceCanUseBedrock(): Promise<boolean> {
  const row = await getInstanceConfig();
  return canUseBedrock(awsSettingsFrom(row));
}

/** DB-only flags for the chat vendor-consent banner — no AWS detection. */
export async function getVendorConsentFlags(): Promise<{
  hasGroqKey: boolean;
  hasEnvGroqKey: boolean;
  externalRiskAckAt: string | null;
  voiceSttChoice: VoiceSttChoice | null;
  voiceSttAudioAckAt: string | null;
  allowRealAws: boolean;
}> {
  const row = await getInstanceConfig();
  return {
    hasGroqKey: Boolean(row?.groqApiKey?.trim()),
    hasEnvGroqKey: Boolean(process.env.GROQ_API_KEY?.trim()),
    externalRiskAckAt: row?.externalRiskAckAt?.toISOString() ?? null,
    voiceSttChoice: parseVoiceSttChoice(row?.voiceSttChoice),
    voiceSttAudioAckAt: row?.voiceSttAudioAckAt?.toISOString() ?? null,
    allowRealAws: Boolean(row?.allowRealAws),
  };
}

export async function getPublicProviderStatus(): Promise<PublicProviderStatus> {
  const row = await getInstanceConfig();
  const aws = await getAwsCredentialStatus(awsSettingsFrom(row));
  const primary = (row?.primaryProvider ?? "auto") as PrimaryProvider;
  return {
    edition: runtimeEdition(),
    deployment: runtimeDeployment(),
    primaryProvider: ["auto", "groq", "bedrock", "ollama"].includes(primary)
      ? primary
      : "auto",
    hasGroqKey: Boolean(row?.groqApiKey?.trim()),
    groqKeyHint: hint(row?.groqApiKey),
    hasEnvGroqKey: Boolean(process.env.GROQ_API_KEY?.trim()),
    bedrockRegion: row?.bedrockRegion ?? aws.region,
    bedrockChatModel: row?.bedrockChatModel ?? process.env.BEDROCK_CHAT_MODEL ?? null,
    externalRiskAckAt: row?.externalRiskAckAt?.toISOString() ?? null,
    voiceSttChoice: parseVoiceSttChoice(row?.voiceSttChoice),
    voiceSttAudioAckAt: row?.voiceSttAudioAckAt?.toISOString() ?? null,
    updatedAt: row?.updatedAt?.toISOString() ?? null,
    aws,
    keys: buildKeyInventory(row, aws),
  };
}

export type ProviderPatch = {
  primaryProvider?: PrimaryProvider;
  groqApiKey?: string | null;
  clearGroqApiKey?: boolean;
  /** Profile name from ~/.aws — a pointer, not a credential. */
  awsProfile?: string | null;
  /** Admin opt-in for billable AWS calls. */
  allowRealAws?: boolean;
  bedrockRegion?: string | null;
  bedrockChatModel?: string | null;
  /** true → stamp ack; false → clear (revokes vendor-API consent). Bedrock uses allowRealAws. */
  acknowledgeExternalRisk?: boolean;
  /** Opt-in STT vendor. Null clears the choice (transcription stays off). */
  voiceSttChoice?: VoiceSttChoice | null;
  /** Spoken audio leaves this host to the STT vendor before any text redaction. */
  acknowledgeVoiceAudio?: boolean;
  /** Unified add-key payload (Admin). AWS credentials are refused here. */
  addKey?: {
    secret: string;
    region?: string;
    label?: string;
    kind?: DetectedKeyKind;
  };
  /** Remove by inventory id: groq-instance | extra:<id> */
  removeKeyId?: string;
};

export async function patchInstanceConfig(
  patch: ProviderPatch,
  updatedByUserId: string,
): Promise<PublicProviderStatus> {
  await ensureInstanceConfig();
  const existing = await getInstanceConfig();
  const data: Record<string, unknown> = { updatedByUserId };

  if (patch.primaryProvider) data.primaryProvider = patch.primaryProvider;
  const hostedKeys = isHostedRuntime();
  if (!hostedKeys) {
    if (patch.clearGroqApiKey) data.groqApiKey = null;
    else if (typeof patch.groqApiKey === "string" && patch.groqApiKey.trim()) {
      data.groqApiKey = encryptSecret(patch.groqApiKey.trim());
    }
  }
  if (patch.awsProfile !== undefined) {
    data.awsProfile = patch.awsProfile?.trim() || null;
  }
  if (patch.allowRealAws !== undefined) {
    data.allowRealAws = patch.allowRealAws;
  }
  if (patch.bedrockRegion !== undefined) {
    data.bedrockRegion = patch.bedrockRegion?.trim() || null;
  }
  if (patch.bedrockChatModel !== undefined) {
    data.bedrockChatModel = patch.bedrockChatModel?.trim() || null;
  }
  if (patch.acknowledgeExternalRisk === true) {
    data.externalRiskAckAt = new Date();
  } else if (patch.acknowledgeExternalRisk === false) {
    data.externalRiskAckAt = null;
  }
  if (patch.acknowledgeVoiceAudio === true) {
    data.voiceSttAudioAckAt = new Date();
  }
  if (patch.voiceSttChoice !== undefined) {
    if (patch.voiceSttChoice === null) {
      data.voiceSttChoice = null;
    } else {
      const choice = parseVoiceSttChoice(patch.voiceSttChoice);
      if (!choice) {
        throw new ProviderConfigError("Transcription provider must be groq or transcribe.");
      }
      const audioAcked =
        patch.acknowledgeVoiceAudio === true || Boolean(existing?.voiceSttAudioAckAt);
      if (!audioAcked) {
        throw new ProviderConfigError(
          "Confirm that spoken audio is sent to the transcription vendor before any redaction.",
        );
      }
      data.voiceSttChoice = choice;
    }
  }

  if (patch.addKey?.secret?.trim()) {
    const secret = patch.addKey.secret.trim();
    const detected = detectProviderKey(secret);
    const kind = patch.addKey.kind ?? detected.kind;

    if (kind === "bedrock" || detected.kind === "bedrock") {
      throw new ProviderConfigError(
        "SecureMind does not accept AWS access keys. Configure credentials in the environment " +
          "(aws sso login, a shared profile, or an instance role) and set ALLOW_REAL_AWS=true.",
      );
    }

    const riskAcked =
      patch.acknowledgeExternalRisk === true
      || (patch.acknowledgeExternalRisk !== false && Boolean(existing?.externalRiskAckAt));
    if (!riskAcked) {
      throw new ProviderConfigError(
        "Acknowledge vendor API risk before saving an external provider key (Groq, OpenAI, etc.). " +
          "Bedrock is separate — it uses your AWS account, not a pasted vendor key.",
      );
    }

    if (kind === "groq") {
      if (!hostedKeys) data.groqApiKey = encryptSecret(secret);
    } else if (!hostedKeys) {
      const extras = parseExtraKeys(existing?.extraProviderKeys);
      extras.push({
        id: crypto.randomUUID(),
        kind,
        label: patch.addKey.label?.trim() || kindDisplayName(kind),
        secret,
        region: patch.addKey.region?.trim() || null,
        createdAt: new Date().toISOString(),
      });
      data.extraProviderKeys = extras.map(k => ({ ...k, secret: encryptSecret(k.secret) ?? k.secret }));
    }
  }

  if (patch.removeKeyId && !hostedKeys) {
    if (patch.removeKeyId === "groq-instance") {
      data.groqApiKey = null;
    } else if (patch.removeKeyId.startsWith("extra:")) {
      const id = patch.removeKeyId.slice("extra:".length);
      data.extraProviderKeys = parseExtraKeys(existing?.extraProviderKeys)
        .filter(k => k.id !== id)
        .map(k => ({ ...k, secret: encryptSecret(k.secret) ?? k.secret }));
    }
  }

  if (hostedKeys) {
    const touchesKeys =
      patch.clearGroqApiKey === true ||
      (typeof patch.groqApiKey === "string" && Boolean(patch.groqApiKey.trim())) ||
      Boolean(patch.addKey?.secret?.trim()) ||
      Boolean(patch.removeKeyId);
    if (touchesKeys) {
      let groq = existing?.groqApiKey?.trim() || null;
      let extras = parseExtraKeys(existing?.extraProviderKeys) as VendorExtraKey[];
      if (patch.clearGroqApiKey || patch.removeKeyId === "groq-instance") groq = null;
      else if (typeof patch.groqApiKey === "string" && patch.groqApiKey.trim()) {
        groq = patch.groqApiKey.trim();
      }
      if (patch.addKey?.secret?.trim()) {
        const secret = patch.addKey.secret.trim();
        const detected = detectProviderKey(secret);
        const kind = patch.addKey.kind ?? detected.kind;
        if (kind === "groq") groq = secret;
        else {
          extras.push({
            id: crypto.randomUUID(),
            kind,
            label: patch.addKey.label?.trim() || kindDisplayName(kind),
            secret,
            region: patch.addKey.region?.trim() || null,
            createdAt: new Date().toISOString(),
          });
        }
      }
      if (patch.removeKeyId?.startsWith("extra:")) {
        const id = patch.removeKeyId.slice("extra:".length);
        extras = extras.filter(k => k.id !== id);
      }
      await writeVendorKeyBundle({ groqApiKey: groq, extra: extras });
      data.groqApiKey = null;
      data.extraProviderKeys = null;
    }
  }

  if (isHostedRuntime()) {
    await hostedInstanceConfig().merge(data);
  } else {
    await db.instanceConfig.update({ where: { id: "singleton" }, data });
  }
  // Profile / region / gate changes must re-run detection immediately.
  resetAwsCredentialCache();
  if (
    patch.groqApiKey !== undefined ||
    patch.clearGroqApiKey ||
    patch.addKey?.secret?.trim() ||
    patch.removeKeyId === "groq-instance" ||
    patch.removeKeyId?.startsWith("extra:")
  ) {
    invalidateModelCatalogCache();
  }
  return getPublicProviderStatus();
}

/** Resolved settings for runtime providers (server-only). */
export async function resolveRuntimeSecrets(): Promise<{
  primaryProvider: PrimaryProvider;
  groqApiKey: string | null;
  instanceGroqApiKey: string | null;
  bedrockRegion: string;
  bedrockChatModel: string | null;
  externalRiskAcknowledged: boolean;
  voiceSttChoice: VoiceSttChoice | null;
  voiceSttAudioAcked: boolean;
}> {
  const row = await getInstanceConfig();
  const primary = (row?.primaryProvider ?? "auto") as PrimaryProvider;
  return {
    primaryProvider: ["auto", "groq", "bedrock", "ollama"].includes(primary)
      ? primary
      : "auto",
    groqApiKey: row?.groqApiKey?.trim() || process.env.GROQ_API_KEY?.trim() || null,
    /** Admin-pasted key only (hosted: Parameter Store vendor-keys overlay). Not the deploy-time Groq bootstrap default. */
    instanceGroqApiKey: row?.groqApiKey?.trim() || null,
    bedrockRegion:
      row?.bedrockRegion?.trim() ||
      process.env.AWS_REGION ||
      process.env.AWS_DEFAULT_REGION ||
      "us-east-1",
    bedrockChatModel:
      row?.bedrockChatModel?.trim() || process.env.BEDROCK_CHAT_MODEL || null,
    externalRiskAcknowledged: Boolean(row?.externalRiskAckAt),
    voiceSttChoice: parseVoiceSttChoice(row?.voiceSttChoice),
    voiceSttAudioAcked: Boolean(row?.voiceSttAudioAckAt),
  };
}

export type InstanceSetupPersist = {
  setupCompletedAt: Date | null;
  setupClaimUsedAt: Date | null;
  storageBackend: string | null;
};

/** Best-effort read. Hosted Amplify may have no Postgres — returns nulls. */
export async function getInstanceSetupPersist(): Promise<InstanceSetupPersist> {
  try {
    if (isHostedRuntime()) {
      const row = await hostedInstanceConfig().get();
      return {
        setupCompletedAt: row?.setupCompletedAt ?? null,
        setupClaimUsedAt: row?.setupClaimUsedAt ?? null,
        storageBackend: row?.storageBackend ?? null,
      };
    }
    const row = await db.instanceConfig.findUnique({
      where: { id: "singleton" },
      select: {
        setupCompletedAt: true,
        setupClaimUsedAt: true,
        storageBackend: true,
      },
    });
    return {
      setupCompletedAt: row?.setupCompletedAt ?? null,
      setupClaimUsedAt: row?.setupClaimUsedAt ?? null,
      storageBackend: row?.storageBackend ?? null,
    };
  } catch {
    return { setupCompletedAt: null, setupClaimUsedAt: null, storageBackend: null };
  }
}

/**
 * Reserve the first-run claim so two simultaneous claims cannot both create an Owner.
 * Exactly one caller gets true. Call releaseSetupClaim() if creating the account then fails.
 */
export async function reserveSetupClaim(): Promise<boolean> {
  if (isHostedRuntime()) {
    return hostedInstanceConfig().reserveClaim();
  }
  await db.instanceConfig.upsert({ where: { id: "singleton" }, create: { id: "singleton" }, update: {} });
  const res = await db.instanceConfig.updateMany({
    where: { id: "singleton", setupClaimUsedAt: null },
    data: { setupClaimUsedAt: new Date() },
  });
  return res.count === 1;
}

export async function releaseSetupClaim(): Promise<void> {
  try {
    if (isHostedRuntime()) {
      await hostedInstanceConfig().releaseClaim();
      return;
    }
    await db.instanceConfig.updateMany({ where: { id: "singleton" }, data: { setupClaimUsedAt: null } });
  } catch (err) {
    console.warn("[setup] could not release claim reservation", err instanceof Error ? err.name : err);
  }
}

export async function markSetupClaimUsed(ownerUserId: string | null): Promise<boolean> {
  try {
    if (isHostedRuntime()) {
      await hostedInstanceConfig().merge({
        setupClaimUsedAt: new Date(),
        ...(ownerUserId ? { ownerUserId } : {}),
      });
      return true;
    }
    await db.instanceConfig.upsert({
      where: { id: "singleton" },
      create: {
        id: "singleton",
        setupClaimUsedAt: new Date(),
        ...(ownerUserId ? { ownerUserId } : {}),
      },
      update: {
        setupClaimUsedAt: new Date(),
        ...(ownerUserId ? { ownerUserId } : {}),
      },
    });
    return true;
  } catch (err) {
    console.warn(
      "[setup] could not persist claim-used (data plane may be unavailable)",
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

export async function completeInstanceSetup(input: {
  storageBackend: WizardStorageChoice;
  userId: string;
}): Promise<boolean> {
  try {
    if (isHostedRuntime()) {
      await hostedInstanceConfig().merge({
        storageBackend: input.storageBackend,
        setupCompletedAt: new Date(),
        updatedByUserId: input.userId,
      });
      return true;
    }
    await db.instanceConfig.upsert({
      where: { id: "singleton" },
      create: {
        id: "singleton",
        storageBackend: input.storageBackend,
        setupCompletedAt: new Date(),
        updatedByUserId: input.userId,
      },
      update: {
        storageBackend: input.storageBackend,
        setupCompletedAt: new Date(),
        updatedByUserId: input.userId,
      },
    });
    return true;
  } catch (err) {
    console.warn(
      "[setup] could not persist wizard complete (data plane may be unavailable)",
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}
