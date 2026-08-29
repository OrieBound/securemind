/**
 * AWS credential discovery for Bedrock.
 *
 * SecureMind never accepts AWS credential *material* through the UI and never
 * stores it in the database. Credentials come from the deployment environment
 * via the AWS SDK default provider chain — the same source the AWS CLI uses:
 *
 *   env vars → shared config/credentials profile (incl. SSO) → container role
 *   → EC2 instance role
 *
 * Everything that is *not* a secret — which profile to use, which region, and
 * whether billable calls are permitted — is configured in the app and stored in
 * `InstanceConfig`. A profile name is a pointer into the operator's ~/.aws
 * files, not a credential.
 *
 * This module stays free of database imports so it can be called from anywhere;
 * the caller supplies the resolved settings.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type AwsCredentialSource =
  | "env"
  | "shared-profile"
  | "container-role"
  | "instance-role"
  | "web-identity"
  | "none";

export type AwsSettings = {
  /** Profile name chosen in the app, if any. */
  profile?: string | null;
  /** Admin opt-in from app settings. */
  allowRealAws?: boolean;
  /** Region chosen in the app, if any. */
  region?: string | null;
};

export type AwsCredentialStatus = {
  /** Effective gate: billable AWS calls are refused unless this is true. */
  allowRealAws: boolean;
  /** True when ALLOW_REAL_AWS=false in the environment forces the gate shut. */
  lockedByEnvironment: boolean;
  /** The SDK chain resolved a usable credential. */
  detected: boolean;
  source: AwsCredentialSource;
  region: string | null;
  /** Profile actually used for the lookup. */
  profile: string | null;
  /** Profile names discovered in ~/.aws — selectable in the UI. */
  availableProfiles: string[];
  /** Last 4 of the resolved access key id, when the chain exposes one. */
  hint: string | null;
  /** Credentials look like Floci test values — fine for contract tests, not Bedrock. */
  looksLikeFloci: boolean;
  /** Credential expiry when the chain returned short-term credentials. */
  expiresAt: string | null;
  /**
   * Who these credentials actually are, from STS GetCallerIdentity. This is the
   * principal Bedrock authorizes — the answer to "which account is it using?".
   */
  caller: {
    accountId: string | null;
    /** Assumed-role ARN, e.g. arn:aws:sts::123:assumed-role/AWSReservedSSO_Admin/user */
    arn: string | null;
    /** Friendly role name pulled out of the ARN. */
    roleName: string | null;
    /** Sign-in name when the ARN carries one (SSO puts it in the session field). */
    sessionName: string | null;
  } | null;
  error: string | null;
};

const DETECT_TTL_MS = 30_000;
/** IMDS lookups hang on non-EC2 hosts; never let Settings wait on that. */
const DETECT_TIMEOUT_MS = 6_000;

let cache: { at: number; key: string; value: AwsCredentialStatus } | null = null;

/** Serializes the env swap below — process.env is global and `fn` awaits. */
let envLock: Promise<unknown> = Promise.resolve();

/**
 * Run `fn` with the Floci-style global endpoint override hidden.
 *
 * `AWS_ENDPOINT_URL` redirects *every* AWS SDK client, including the SSO client
 * used to resolve profile credentials and the Bedrock client itself. Pointed at
 * Floci it makes a valid SSO login fail with an XML parse error, and it would
 * silently send Bedrock traffic to localhost. Cognito reads its own endpoint
 * explicitly, so nothing else needs this variable visible.
 *
 * Placeholder static keys are hidden too when a profile is in play: the SDK
 * warns about "multiple credential sources" even though the profile wins.
 */
export async function withRealAwsEndpoints<T>(fn: () => Promise<T>): Promise<T> {
  const run = async () => {
    const saved: Record<string, string | undefined> = {};
    const hide = (name: string) => {
      saved[name] = process.env[name];
      delete process.env[name];
    };

    hide("AWS_ENDPOINT_URL");
    if (isPlaceholder(process.env.AWS_ACCESS_KEY_ID)) {
      hide("AWS_ACCESS_KEY_ID");
      hide("AWS_SECRET_ACCESS_KEY");
      hide("AWS_SESSION_TOKEN");
    }

    try {
      return await fn();
    } finally {
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  };

  const result = envLock.then(run, run);
  envLock = result.catch(() => undefined);
  return result;
}

/**
 * Environment override. Returns true/false when explicitly set, else null so
 * the app-level toggle decides. An explicit `false` is a hard kill switch for
 * CI and locked-down deployments.
 */
function envAllowOverride(): boolean | null {
  const v = process.env.ALLOW_REAL_AWS?.trim().toLowerCase();
  if (v === undefined || v === "") return null;
  if (v === "true" || v === "1") return true;
  return false;
}

function isPlaceholder(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v === "test" || v === "testing" || v === "dummy" || v === "floci";
}

function awsDir(): string {
  return join(homedir(), ".aws");
}

function configPaths(): string[] {
  return [
    process.env.AWS_SHARED_CREDENTIALS_FILE || join(awsDir(), "credentials"),
    process.env.AWS_CONFIG_FILE || join(awsDir(), "config"),
  ];
}

/**
 * Profile names found in the operator's shared AWS files. Only section headers
 * are read — credential values are never parsed or returned.
 */
export function listAwsProfiles(): string[] {
  const names = new Set<string>();
  for (const path of configPaths()) {
    try {
      if (!existsSync(path)) continue;
      for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
        const match = /^\s*\[([^\]]+)\]\s*$/.exec(line);
        if (!match) continue;
        // ~/.aws/config uses "[profile name]"; credentials uses "[name]".
        const raw = match[1].trim();
        const name = raw.startsWith("profile ") ? raw.slice("profile ".length).trim() : raw;
        if (name && name !== "sso-session" && !name.startsWith("sso-session ")) {
          names.add(name);
        }
      }
    } catch {
      // Unreadable config is not an error worth surfacing.
    }
  }
  return [...names].sort();
}

function sharedConfigExists(): boolean {
  return configPaths().some(p => {
    try {
      return existsSync(p);
    } catch {
      return false;
    }
  });
}

function classifySource(profile: string | null): AwsCredentialSource {
  if (profile) return "shared-profile";
  if (
    process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI ||
    process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI
  ) {
    return "container-role";
  }
  if (process.env.AWS_WEB_IDENTITY_TOKEN_FILE) return "web-identity";
  // Placeholder keys are hidden during resolution, so they are never the source.
  if (
    process.env.AWS_ACCESS_KEY_ID?.trim() &&
    process.env.AWS_SECRET_ACCESS_KEY?.trim() &&
    !isPlaceholder(process.env.AWS_ACCESS_KEY_ID)
  ) {
    return "env";
  }
  if (sharedConfigExists()) return "shared-profile";
  return "instance-role";
}

function resolveRegion(settings: AwsSettings): string | null {
  return (
    settings.region?.trim() ||
    process.env.AWS_REGION?.trim() ||
    process.env.AWS_DEFAULT_REGION?.trim() ||
    null
  );
}

function resolveProfile(settings: AwsSettings): string | null {
  return settings.profile?.trim() || process.env.AWS_PROFILE?.trim() || null;
}

/** Effective gate: env override wins, otherwise the app toggle. */
export function resolveAllowRealAws(settings: AwsSettings): {
  allowed: boolean;
  lockedByEnvironment: boolean;
} {
  const override = envAllowOverride();
  if (override === false) return { allowed: false, lockedByEnvironment: true };
  if (override === true) return { allowed: true, lockedByEnvironment: false };
  return { allowed: Boolean(settings.allowRealAws), lockedByEnvironment: false };
}

/**
 * Ask STS who the resolved credentials belong to.
 *
 * Bedrock authorizes a *principal*, not a person: with an SSO profile that is
 * the assumed role in the profile's account. Surfacing it removes the guesswork
 * about which account a request will be billed and authorized against.
 * Best-effort — a denied sts:GetCallerIdentity must not break detection.
 */
async function describeCaller(
  region: string,
  profile: string | null,
): Promise<AwsCredentialStatus["caller"]> {
  try {
    return await withRealAwsEndpoints(async () => {
      const { STSClient, GetCallerIdentityCommand } = await import("@aws-sdk/client-sts");
      const { fromNodeProviderChain } = await import("@aws-sdk/credential-providers");
      const client = new STSClient({
        region,
        ...(profile ? { credentials: fromNodeProviderChain({ profile }) } : {}),
      });
      const out = await client.send(new GetCallerIdentityCommand({}));
      const arn = out.Arn ?? null;
      // arn:aws:sts::<acct>:assumed-role/<roleName>/<sessionName>
      const parts = arn?.split("/") ?? [];
      return {
        accountId: out.Account ?? null,
        arn,
        roleName: parts.length >= 2 ? parts[1] : null,
        sessionName: parts.length >= 3 ? parts.slice(2).join("/") : null,
      };
    });
  } catch {
    return null;
  }
}

/**
 * Resolve the current AWS credential status. Detection runs even when the gate
 * is closed so Settings can explain what is present and what is blocking use.
 */
export async function getAwsCredentialStatus(
  settings: AwsSettings = {},
): Promise<AwsCredentialStatus> {
  const profile = resolveProfile(settings);
  const region = resolveRegion(settings);
  const gate = resolveAllowRealAws(settings);
  const key = `${profile ?? ""}|${region ?? ""}|${gate.allowed}`;

  const now = Date.now();
  if (cache && cache.key === key && now - cache.at < DETECT_TTL_MS) return cache.value;

  const base: AwsCredentialStatus = {
    allowRealAws: gate.allowed,
    lockedByEnvironment: gate.lockedByEnvironment,
    detected: false,
    source: "none",
    region,
    profile,
    availableProfiles: listAwsProfiles(),
    hint: null,
    looksLikeFloci: false,
    expiresAt: null,
    caller: null,
    error: null,
  };

  // Floci placeholders are hidden during resolution rather than treated as a
  // hard stop, so a real shared profile still resolves on a Floci-configured host.
  const placeholdersPresent =
    isPlaceholder(process.env.AWS_ACCESS_KEY_ID) ||
    isPlaceholder(process.env.AWS_SECRET_ACCESS_KEY);

  let value: AwsCredentialStatus;
  try {
    const { fromNodeProviderChain } = await import("@aws-sdk/credential-providers");
    const creds = await withRealAwsEndpoints(() => {
      const provider = fromNodeProviderChain({
        ignoreCache: true,
        ...(profile ? { profile } : {}),
      });
      return Promise.race([
        provider(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("timeout")), DETECT_TIMEOUT_MS),
        ),
      ]);
    });
    const detected = Boolean(creds?.accessKeyId) && !isPlaceholder(creds?.accessKeyId);
    value = {
      ...base,
      detected,
      source: classifySource(profile),
      hint: creds?.accessKeyId ? `…${creds.accessKeyId.slice(-4)}` : null,
      expiresAt: creds?.expiration ? creds.expiration.toISOString() : null,
      caller: detected && region ? await describeCaller(region, profile) : null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    value = {
      ...base,
      looksLikeFloci: placeholdersPresent,
      error:
        message === "timeout"
          ? "Credential lookup timed out (no instance role on this host)."
          : profile
            ? `Profile "${profile}" has no usable credentials. Try: aws sso login --profile ${profile}`
            : placeholdersPresent
              ? "Only Floci placeholder credentials are present. Select a real profile above, or sign in with the AWS CLI."
              : "No AWS credentials found. Sign in with the AWS CLI or select a profile.",
    };
  }

  cache = { at: now, key, value };
  return value;
}

/** Bedrock may run only with real credentials, a region, and the gate open. */
export async function canUseBedrock(settings: AwsSettings = {}): Promise<boolean> {
  const status = await getAwsCredentialStatus(settings);
  return (
    status.allowRealAws &&
    status.detected &&
    !status.looksLikeFloci &&
    Boolean(status.region)
  );
}

/** Clears the detection cache. Call after settings change; also a test helper. */
export function resetAwsCredentialCache(): void {
  cache = null;
}
