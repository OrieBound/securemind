/**
 * Instance-level PII security policy (Admin-owned).
 *
 * - Sensitivity + safe terms live on InstanceConfig (not localStorage as source of truth).
 * - Members may propose changes; only Admin can apply.
 * - Policy changes apply going forward only (new chat sends + new Knowledge ingest).
 *   Stored messages/documents are never re-scanned. Already-redacted values cannot be restored.
 */

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ensureInstanceConfig, getInstanceConfig } from "@/lib/instance-config";
import { isHostedRuntime } from "@/lib/runtime-env";
import {
  DEFAULT_SAFE_TERMS,
  DEFAULT_SENSITIVITY,
  omitRetiredDefaultSafeTerms,
  parsePiiSensitivityTier,
  SENSITIVITY_TIERS,
  validateSafeTerm,
  type PiiSensitivityTier,
  type SafeTerm,
  type SafeTermKind,
} from "@/lib/pii";

export function tierRank(tier: PiiSensitivityTier): number {
  return SENSITIVITY_TIERS.indexOf(tier);
}

export function isStricterTier(next: PiiSensitivityTier, current: PiiSensitivityTier): boolean {
  return tierRank(next) > tierRank(current);
}

function parseSafeTerms(raw: unknown): SafeTerm[] {
  if (!Array.isArray(raw)) return [];
  const out: SafeTerm[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (typeof r.id !== "string" || typeof r.value !== "string") continue;
    const kind = r.kind;
    if (kind !== "literal" && kind !== "cidr" && kind !== "domain" && kind !== "prefix") continue;
    const check = validateSafeTerm(r.value, kind);
    if (!check.ok) continue;
    out.push({
      id: r.id,
      kind,
      value: r.value.trim(),
      label: typeof r.label === "string" ? r.label : undefined,
    });
  }
  return omitRetiredDefaultSafeTerms(out);
}

/** Defaults + instance exemptions (instance wins on id collision by appending). */
export function mergeSafeTerms(instance: SafeTerm[]): SafeTerm[] {
  const seen = new Set<string>();
  const out: SafeTerm[] = [];
  for (const t of omitRetiredDefaultSafeTerms([...DEFAULT_SAFE_TERMS, ...instance])) {
    const key = `${t.kind}:${t.value.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

export type SecurityPolicyPublic = {
  piiSensitivity: PiiSensitivityTier;
  safeTerms: SafeTerm[];
  pending: null | {
    piiSensitivity: PiiSensitivityTier;
    safeTerms: SafeTerm[] | null;
    proposedByUserId: string | null;
    proposedAt: string | null;
    note: string | null;
    stricterThanActive: boolean;
  };
  updatedAt: string | null;
  updatedByUserId: string | null;
};

export async function getSecurityPolicy(): Promise<SecurityPolicyPublic> {
  await ensureInstanceConfig();
  const row = await getInstanceConfig();
  const piiSensitivity = parsePiiSensitivityTier(row?.piiSensitivity) ?? DEFAULT_SENSITIVITY;
  const safeTerms = parseSafeTerms(row?.safeTerms);
  const pendingTier = parsePiiSensitivityTier(row?.pendingPiiSensitivity);
  const pendingTerms = row?.pendingSafeTerms != null ? parseSafeTerms(row.pendingSafeTerms) : null;

  return {
    piiSensitivity,
    safeTerms,
    pending: pendingTier
      ? {
          piiSensitivity: pendingTier,
          safeTerms: pendingTerms,
          proposedByUserId: row?.pendingProposedByUserId ?? null,
          proposedAt: row?.pendingProposedAt?.toISOString() ?? null,
          note: row?.pendingNote ?? null,
          stricterThanActive: isStricterTier(pendingTier, piiSensitivity),
        }
      : null,
    updatedAt: row?.updatedAt?.toISOString() ?? null,
    updatedByUserId: row?.updatedByUserId ?? null,
  };
}

export async function resolveIngestScrubOptions(): Promise<{
  sensitivity: PiiSensitivityTier;
  safeTerms: SafeTerm[];
}> {
  const policy = await getSecurityPolicy();
  return {
    sensitivity: policy.piiSensitivity,
    safeTerms: mergeSafeTerms(policy.safeTerms),
  };
}

export async function applySecurityPolicy(opts: {
  actorUserId: string;
  piiSensitivity: PiiSensitivityTier;
  safeTerms: SafeTerm[];
}): Promise<{ policy: SecurityPolicyPublic }> {
  await ensureInstanceConfig();
  if (isHostedRuntime()) {
    const { hostedInstanceConfig } = await import("@/lib/instance-config-hosted");
    await hostedInstanceConfig().merge({
      piiSensitivity: opts.piiSensitivity,
      safeTerms: opts.safeTerms,
      pendingPiiSensitivity: null,
      pendingSafeTerms: null,
      pendingProposedByUserId: null,
      pendingProposedAt: null,
      pendingNote: null,
      updatedByUserId: opts.actorUserId,
    });
  } else {
    await db.instanceConfig.update({
      where: { id: "singleton" },
      data: {
        piiSensitivity: opts.piiSensitivity,
        safeTerms: opts.safeTerms,
        pendingPiiSensitivity: null,
        pendingSafeTerms: Prisma.DbNull,
        pendingProposedByUserId: null,
        pendingProposedAt: null,
        pendingNote: null,
        updatedByUserId: opts.actorUserId,
      },
    });
  }

  return { policy: await getSecurityPolicy() };
}

export async function proposeSecurityPolicy(opts: {
  actorUserId: string;
  piiSensitivity: PiiSensitivityTier;
  safeTerms?: SafeTerm[];
  note?: string;
}): Promise<SecurityPolicyPublic> {
  await ensureInstanceConfig();
  if (isHostedRuntime()) {
    const { hostedInstanceConfig } = await import("@/lib/instance-config-hosted");
    await hostedInstanceConfig().merge({
      pendingPiiSensitivity: opts.piiSensitivity,
      pendingSafeTerms: opts.safeTerms ?? undefined,
      pendingProposedByUserId: opts.actorUserId,
      pendingProposedAt: new Date(),
      pendingNote: opts.note?.slice(0, 500) ?? null,
    });
  } else {
    await db.instanceConfig.update({
      where: { id: "singleton" },
      data: {
        pendingPiiSensitivity: opts.piiSensitivity,
        pendingSafeTerms: opts.safeTerms ?? undefined,
        pendingProposedByUserId: opts.actorUserId,
        pendingProposedAt: new Date(),
        pendingNote: opts.note?.slice(0, 500) ?? null,
      },
    });
  }
  return getSecurityPolicy();
}

export async function clearPendingProposal(): Promise<SecurityPolicyPublic> {
  await ensureInstanceConfig();
  if (isHostedRuntime()) {
    const { hostedInstanceConfig } = await import("@/lib/instance-config-hosted");
    await hostedInstanceConfig().merge({
      pendingPiiSensitivity: null,
      pendingSafeTerms: null,
      pendingProposedByUserId: null,
      pendingProposedAt: null,
      pendingNote: null,
    });
  } else {
    await db.instanceConfig.update({
      where: { id: "singleton" },
      data: {
        pendingPiiSensitivity: null,
        pendingSafeTerms: Prisma.DbNull,
        pendingProposedByUserId: null,
        pendingProposedAt: null,
        pendingNote: null,
      },
    });
  }
  return getSecurityPolicy();
}

export function normalizeSafeTermsInput(raw: unknown): SafeTerm[] | { error: string } {
  if (!Array.isArray(raw)) return { error: "safeTerms must be an array" };
  const out: SafeTerm[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return { error: "Invalid safe term" };
    const r = item as Record<string, unknown>;
    const kind = r.kind as SafeTermKind;
    const value = typeof r.value === "string" ? r.value : "";
    const check = validateSafeTerm(value, kind);
    if (!check.ok) return { error: check.reason };
    out.push({
      id: typeof r.id === "string" && r.id ? r.id : crypto.randomUUID(),
      kind,
      value: value.trim(),
      label: typeof r.label === "string" ? r.label : undefined,
    });
  }
  return out;
}
