/**
 * Resolve pasted vendor API keys from InstanceConfig (never from the client).
 */

import { getInstanceConfig } from "@/lib/instance-config";
import type { DetectedKeyKind } from "@/lib/provider-key-detect";
import { isWiredVendorKind, type WiredVendorKind } from "@/lib/vendor-providers";
import { isHostedRuntime } from "@/lib/runtime-env";

type ExtraKeyRow = {
  id: string;
  kind: DetectedKeyKind;
  secret: string;
};

function parseExtraKeys(raw: unknown): ExtraKeyRow[] {
  if (!Array.isArray(raw)) return [];
  const out: ExtraKeyRow[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    if (typeof r.secret !== "string" || !r.secret.trim()) continue;
    const kind = (typeof r.kind === "string" ? r.kind : "unknown") as DetectedKeyKind;
    out.push({
      id: typeof r.id === "string" ? r.id : "",
      kind,
      secret: r.secret.trim(),
    });
  }
  return out;
}

/** Latest extra key for a vendor kind (most recently appended wins). */
export async function resolveVendorApiKey(kind: WiredVendorKind): Promise<string | null> {
  if (!isWiredVendorKind(kind)) return null;
  const row = await getInstanceConfig();
  if (!row?.externalRiskAckAt) return null;

  if (kind === "groq") {
    const instance = row.groqApiKey?.trim() || null;
    if (isHostedRuntime()) return instance;
    return instance || process.env.GROQ_API_KEY?.trim() || null;
  }

  const extras = parseExtraKeys(row.extraProviderKeys);
  for (let i = extras.length - 1; i >= 0; i--) {
    const k = extras[i]!;
    if (k.kind === kind) return k.secret;
  }
  return null;
}

export async function hasVendorRuntime(kind: WiredVendorKind): Promise<boolean> {
  return Boolean(await resolveVendorApiKey(kind));
}
