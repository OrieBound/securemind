/**
 * Admin-pasted vendor API keys on hosted installs.
 * Parameter Store (SecureString) holds the values; InstanceConfig / Dynamo does not.
 *
 * Local / on-prem still uses encrypted InstanceConfig (secret-at-rest).
 * AWS access keys are never stored here.
 */

import { GetParameterCommand, PutParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { secretRef, type SecretRef } from "@/lib/aws-secrets";
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

/**
 * In-process SM cache. Empty snapshots must not stick: Amplify SSR workers that
 * GetSecretValue before a Put (voice setup, Providers paste) would keep showing
 * "Not configured" / "No vendor keys stored yet" after the secret actually has a key.
 */
const CACHE_TTL_MS = 3_000;
let cache: VendorKeyBundle | null = null;
let cacheAt = 0;
let testStore: VendorKeyBundle | null | undefined;

function cloneBundle(bundle: VendorKeyBundle): VendorKeyBundle {
  return {
    groqApiKey: bundle.groqApiKey,
    extra: bundle.extra.map(k => ({ ...k })),
  };
}

function bundleIsEmpty(bundle: VendorKeyBundle): boolean {
  return !bundle.groqApiKey && bundle.extra.length === 0;
}

/** Exported for tests — empty reads are never a cache hit. */
export function vendorKeyCacheIsLive(
  snapshot: VendorKeyBundle | null,
  savedAt: number,
  now: number,
  ttlMs = CACHE_TTL_MS,
): boolean {
  if (!snapshot || bundleIsEmpty(snapshot)) return false;
  return now - savedAt < ttlMs;
}

/** Where the keys are stored: the VENDOR_KEYS_PARAM parameter. */
export function vendorKeysRef(): SecretRef | null {
  return secretRef("VENDOR_KEYS_PARAM");
}

/** Tests only — in-memory stand-in for Parameter Store. */
export function resetVendorKeyStoreForTests(bundle?: VendorKeyBundle | null): void {
  cache = null;
  cacheAt = 0;
  testStore = bundle === undefined ? undefined : bundle;
}

function region(): string {
  return (
    process.env.AWS_REGION ||
    process.env.AWS_DEFAULT_REGION ||
    process.env.COGNITO_REGION ||
    "us-east-1"
  );
}

async function readStored(ref: SecretRef): Promise<string | null> {
  const out = await new SSMClient({ region: region() }).send(
    new GetParameterCommand({ Name: ref.id, WithDecryption: true }),
  );
  return out.Parameter?.Value ?? null;
}

async function writeStored(ref: SecretRef, value: string): Promise<void> {
  // Advanced tier so a long list of keys fits (8 KB, not 4 KB). Overwrite keeps one parameter.
  await new SSMClient({ region: region() }).send(
    new PutParameterCommand({ Name: ref.id, Value: value, Type: "SecureString", Overwrite: true, Tier: "Advanced" }),
  );
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
    return cloneBundle(testStore ?? EMPTY);
  }
  if (vendorKeyCacheIsLive(cache, cacheAt, Date.now())) {
    return cloneBundle(cache!);
  }
  const ref = vendorKeysRef();
  if (!ref) return { groqApiKey: null, extra: [] };

  const bundle = await withRealAwsEndpoints(async () => {
    try {
      const raw = (await readStored(ref))?.trim();
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
  if (bundleIsEmpty(bundle)) {
    cache = null;
    cacheAt = 0;
  } else {
    cache = bundle;
    cacheAt = Date.now();
  }
  return cloneBundle(bundle);
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
    cacheAt = Date.now();
    return;
  }
  const ref = vendorKeysRef();
  if (!ref) {
    throw new Error(
      "VENDOR_KEYS_PARAM is not set. Redeploy so Admin-pasted vendor keys go to Parameter Store.",
    );
  }
  await withRealAwsEndpoints(async () => {
    await writeStored(
      ref,
      JSON.stringify({
        groqApiKey: next.groqApiKey,
        extra: next.extra,
      }),
    );
  });
  cache = next;
  cacheAt = Date.now();
}
