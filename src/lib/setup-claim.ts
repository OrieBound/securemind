/**
 * First-run instance claim: empty Cognito directory → Owner account.
 *
 * Hosted (Amplify): operator-printed SETUP_CLAIM_SECRET required. The code is
 * not the Cognito password and is never returned by APIs.
 * Local / on-prem: email + chosen password only. SETUP_CLAIM_SECRET is ignored.
 */

import { timingSafeEqual } from "node:crypto";
import { cognitoLogin } from "@/lib/cognito";
import {
  CognitoAdminError,
  claimFirstAdmin,
  cognitoAdminAvailable,
  cognitoDirectoryIsEmpty,
} from "@/lib/cognito-admin";
import {
  completeInstanceSetup,
  getInstanceSetupPersist,
  markSetupClaimUsed,
} from "@/lib/instance-config";
import {
  isHostedRuntime,
  resolveStorageBackend,
  runtimeEdition,
} from "@/lib/runtime-env";
import {
  isValidWizardStorage,
  parseWizardStorage,
  type WizardStorageChoice,
} from "@/lib/wizard-storage";
import { ensureUserProfile } from "@/lib/user-profile";
import {
  directoryPasswordPolicy,
  validateDirectoryPassword,
} from "@/lib/auth-password";

export class SetupClaimError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "SetupClaimError";
    this.status = status;
  }
}

export function claimRequiresSetupCode(): boolean {
  return isHostedRuntime();
}

export function setupClaimSecretConfigured(): boolean {
  return Boolean(process.env.SETUP_CLAIM_SECRET?.trim());
}

export function minClaimPasswordLength(): number {
  return directoryPasswordPolicy().minLength;
}

/** Constant-time compare. Different lengths still return false without throwing. */
export function setupCodesMatch(provided: string | undefined): boolean {
  const expected = process.env.SETUP_CLAIM_SECRET?.trim() ?? "";
  const given = (provided ?? "").trim();
  if (!expected || !given) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function publicSignupAllowed(): boolean {
  return false;
}

function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

function assertEmailPair(email: string, emailConfirm: string): string {
  const a = normalizeEmail(email);
  const b = normalizeEmail(emailConfirm);
  if (!a || !a.includes("@") || a.length > 320) {
    throw new SetupClaimError("A valid email is required.", 422);
  }
  if (a !== b) {
    throw new SetupClaimError("Email confirmation does not match.", 422);
  }
  return a;
}

function assertPassword(password: string, confirm: string): void {
  const checked = validateDirectoryPassword(password);
  if (!checked.ok) {
    throw new SetupClaimError(checked.error, 422);
  }
  if (password !== confirm) {
    throw new SetupClaimError("Password confirmation does not match.", 422);
  }
}

export type SetupStatus = {
  authMode: string;
  edition: "local" | "cloud";
  cognitoConfigured: boolean;
  directoryEmpty: boolean | null;
  claimAvailable: boolean;
  claimRequiresCode: boolean;
  codeConfigured: boolean;
  setupComplete: boolean;
  preferredStorage: WizardStorageChoice;
  minPasswordLength: number;
};

export async function getSetupStatus(opts?: {
  cookieSetupComplete?: boolean;
}): Promise<SetupStatus> {
  const persist = await getInstanceSetupPersist();
  const cognitoConfigured = cognitoAdminAvailable();
  let directoryEmpty: boolean | null = null;
  if (cognitoConfigured) {
    try {
      directoryEmpty = await cognitoDirectoryIsEmpty();
    } catch (err) {
      console.warn(
        "[setup/status] ListUsers failed",
        err instanceof Error ? `${err.name}: ${err.message.slice(0, 160)}` : err,
      );
      directoryEmpty = null;
    }
  }

  const claimAvailable =
    cognitoConfigured &&
    !persist.setupClaimUsedAt &&
    directoryEmpty !== false &&
    (directoryEmpty === true || (claimRequiresSetupCode() && setupClaimSecretConfigured()));

  const setupComplete = Boolean(persist.setupCompletedAt) || Boolean(opts?.cookieSetupComplete);

  return {
    authMode: process.env.AUTH_MODE ?? "local",
    edition: runtimeEdition(),
    cognitoConfigured,
    directoryEmpty,
    claimAvailable,
    claimRequiresCode: claimRequiresSetupCode(),
    codeConfigured: setupClaimSecretConfigured(),
    setupComplete,
    preferredStorage: parseWizardStorage(
      persist.storageBackend,
      runtimeEdition(),
      resolveStorageBackend(),
    ),
    minPasswordLength: minClaimPasswordLength(),
  };
}

export type ClaimInput = {
  email?: unknown;
  emailConfirm?: unknown;
  password?: unknown;
  passwordConfirm?: unknown;
  setupCode?: unknown;
  userId?: unknown;
};

export type ClaimResult = {
  ok: true;
  expiresIn: number;
  accessToken: string;
};

export async function runFirstAdminClaim(input: ClaimInput): Promise<ClaimResult> {
  void input.userId;

  const persist = await getInstanceSetupPersist();
  if (persist.setupClaimUsedAt) {
    throw new SetupClaimError("This instance already has an owner.", 409);
  }

  if (!cognitoAdminAvailable()) {
    throw new SetupClaimError("Cognito is not configured.", 503);
  }

  let empty = false;
  try {
    empty = await cognitoDirectoryIsEmpty();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Could not read the user directory.";
    throw new SetupClaimError(msg, 503);
  }
  if (!empty) {
    throw new SetupClaimError("This instance already has an owner.", 409);
  }

  if (claimRequiresSetupCode()) {
    if (!setupClaimSecretConfigured()) {
      throw new SetupClaimError(
        "This instance is missing its setup code. Apply Terraform and use the value from `terraform output -raw setup_claim_secret`.",
        503,
      );
    }
    if (!setupCodesMatch(typeof input.setupCode === "string" ? input.setupCode : "")) {
      throw new SetupClaimError("Invalid setup code.", 403);
    }
  }

  const email = assertEmailPair(
    typeof input.email === "string" ? input.email : "",
    typeof input.emailConfirm === "string" ? input.emailConfirm : "",
  );
  const password = typeof input.password === "string" ? input.password : "";
  const passwordConfirm =
    typeof input.passwordConfirm === "string" ? input.passwordConfirm : "";
  assertPassword(password, passwordConfirm);

  let created;
  try {
    created = await claimFirstAdmin({ email, password });
  } catch (err) {
    if (err instanceof CognitoAdminError) {
      throw new SetupClaimError(err.message, err.status);
    }
    const msg = err instanceof Error ? err.message : "Could not create the owner account.";
    if (/UsernameExistsException|already exists/i.test(msg)) {
      throw new SetupClaimError("This instance already has an owner.", 409);
    }
    if (/InvalidPasswordException/i.test(msg)) {
      throw new SetupClaimError(
        "Password does not meet the directory policy (length and character classes).",
        422,
      );
    }
    if (/Could not load credentials from any providers/i.test(msg)) {
      throw new SetupClaimError(
        "This host cannot call Cognito yet (no Amplify SSR compute role). An operator must attach the compute IAM role.",
        503,
      );
    }
    throw new SetupClaimError("Could not create the owner account.", 502);
  }

  await markSetupClaimUsed(created.sub);

  const tokens = await cognitoLogin(email, password);
  if (created.sub) {
    try {
      await ensureUserProfile({ userId: created.sub, email, touchSignIn: true });
    } catch (err) {
      console.warn("[setup/claim] profile upsert", err instanceof Error ? err.message : err);
    }
  }

  return {
    ok: true,
    expiresIn: tokens.expiresIn,
    accessToken: tokens.accessToken,
  };
}

export async function runSetupComplete(
  userId: string,
  input: { storageBackend?: unknown; riskAck?: unknown },
  cookieAlreadySet: boolean,
): Promise<{ ok: true; persisted: boolean; setupComplete: true }> {
  if (input.riskAck !== true) {
    throw new SetupClaimError(
      "Please acknowledge that you remain responsible for your decisions and any information you choose to enter, upload, or share through SecureMind.",
      422,
    );
  }
  const edition = runtimeEdition();
  const backend = parseWizardStorage(
    typeof input.storageBackend === "string" ? input.storageBackend : null,
    edition,
    "postgres",
  );
  if (!isValidWizardStorage(backend, edition)) {
    throw new SetupClaimError(
      edition === "cloud"
        ? "This hosted install uses DynamoDB."
        : "Local setup uses Postgres with pgvector.",
      422,
    );
  }
  const persisted = await completeInstanceSetup({
    storageBackend: backend,
    userId,
  });
  return { ok: true, persisted: persisted || cookieAlreadySet, setupComplete: true };
}
