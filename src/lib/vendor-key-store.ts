/**
 * Admin-pasted vendor API keys on hosted installs.
 * Secrets Manager holds the values; InstanceConfig / Dynamo does not.
 *
 * Local / on-prem still uses encrypted InstanceConfig (secret-at-rest).
 * AWS access keys are never stored here.
 */

import {
  GetSecretValueCommand,
  PutSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { withRealAwsEndpoints } from "@/lib/aws-credentials";
import { isHostedRuntime } from "@/lib/runtime-env";
import type { DetectedKeyKind } from "@/lib/provider-key-detect";

export type VendorExtraKey = {
  id: string;
  kind: DetectedKeyKind;
  label: string;
  secret: string;
  region?: string | null;
  createdAt: string;
};

export type VendorKeyBundle = {
  groqApiKey: string | null;
  extra: VendorExtraKey[];
};

const EMPTY: VendorKeyBundle = { groqApiKey: null, extra: [] };

let cache: VendorKeyBundle | null = null;
let testStore: VendorKeyBundle | null | undefined;

export function vendorKeysSecretId(): string | null {
  return process.env.VENDOR_KEYS_SECRET_ARN?.trim() || null;
}

/** Tests only — in-memory stand-in for Secrets Manager. */
export function resetVendorKeyStoreForTests(bundle?: VendorKeyBundle | null): void {
  cache = null;
  testStore = bundle === undefined ? undefined : bundle;
}

function client(): SecretsManagerClient {
  return new SecretsManagerClient({
    region:
      process.env.AWS_REGION ||
      process.env.AWS_DEFAULT_REGION ||
      process.env.COGNITO_REGION ||
      "us-east-1",
  });
}

export function parseVendorKeyBundle(raw: unknown): VendorKeyBundle {
  if (!raw || typeof raw !== "object") return { ...EMPTY, extra: [] };
  const o = raw as Record<string, unknown>;
  const groq =
    typeof o.groqApiKey === "string" && o.groqApiKey.trim() ? o.groqApiKey.trim() : null;
  const extra: VendorExtraKey[] = [];
  if (Array.isArray(o.extra)) {
    for (const row of o.extra) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      if (typeof r.id !== "string" || typeof r.secret !== "string" || !r.secret.trim()) continue;
      extra.push({
        id: r.id,
        kind: (typeof r.kind === "string" ? r.kind : "unknown") as DetectedKeyKind,
        label: typeof r.label === "string" ? r.label : "key",
        secret: r.secret.trim(),
        region: typeof r.region === "string" ? r.region : null,
        createdAt: typeof r.createdAt === "string" ? r.createdAt : new Date().toISOString(),
      });
    }
  }
  return { groqApiKey: groq, extra };
}

export async function readVendorKeyBundle(): Promise<VendorKeyBundle> {
  if (!isHostedRuntime()) return { groqApiKey: null, extra: [] };
  if (testStore !== undefined) {
    cache = testStore ?? { groqApiKey: null, extra: [] };
    return {
      groqApiKey: cache.groqApiKey,
      extra: cache.extra.map(k => ({ ...k })),
    };
  }
  if (cache) {
    return { groqApiKey: cache.groqApiKey, extra: cache.extra.map(k => ({ ...k })) };
  }
  const id = vendorKeysSecretId();
  if (!id) return { groqApiKey: null, extra: [] };

  const bundle = await withRealAwsEndpoints(async () => {
    try {
      const out = await client().send(new GetSecretValueCommand({ SecretId: id }));
      const raw = out.SecretString?.trim();
      if (!raw) return { groqApiKey: null, extra: [] as VendorExtraKey[] };
      try {
        return parseVendorKeyBundle(JSON.parse(raw) as unknown);
      } catch {
        return { groqApiKey: raw, extra: [] as VendorExtraKey[] };
      }
    } catch {
      return { groqApiKey: null, extra: [] as VendorExtraKey[] };
    }
  });
  cache = bundle;
  return { groqApiKey: bundle.groqApiKey, extra: bundle.extra.map(k => ({ ...k })) };
}

export async function writeVendorKeyBundle(bundle: VendorKeyBundle): Promise<void> {
  if (!isHostedRuntime()) return;
  const next: VendorKeyBundle = {
    groqApiKey: bundle.groqApiKey?.trim() || null,
    extra: bundle.extra.filter(k => k.secret.trim()),
  };
  if (testStore !== undefined) {
    testStore = next;
    cache = next;
    return;
  }
  const id = vendorKeysSecretId();
  if (!id) {
    throw new Error(
      "VENDOR_KEYS_SECRET_ARN is not set. Redeploy so Admin-pasted vendor keys go to Secrets Manager.",
    );
  }
  await withRealAwsEndpoints(async () => {
    await client().send(
      new PutSecretValueCommand({
        SecretId: id,
        SecretString: JSON.stringify({
          groqApiKey: next.groqApiKey,
          extra: next.extra,
        }),
      }),
    );
  });
  cache = next;
}
