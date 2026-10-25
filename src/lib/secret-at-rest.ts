/**
 * Local at-rest encryption for Admin-entered vendor keys.
 *
 * Env INSTANCE_ENCRYPTION_KEY (32-byte hex or any passphrase) is preferred.
 * Otherwise a key file is created under INSTANCE_KEY_FILE or .data/instance.key.
 * Developer .env keys stay in the environment and are never written here.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const PREFIX = "smenc:v1:";
const ALGO = "aes-256-gcm";

function isHostedRuntime(): boolean {
  return Boolean(
    process.env.AMPLIFY_HOSTING ||
      process.env.AWS_LAMBDA_FUNCTION_NAME ||
      process.env.SECUREMIND_EDITION === "cloud" ||
      process.env.SECUREMIND_EDITION === "hosted",
  );
}

function keyFilePath(): string {
  if (process.env.INSTANCE_KEY_FILE?.trim()) return process.env.INSTANCE_KEY_FILE.trim();
  // Relative path only — process.cwd() makes Turbopack NFT-trace the whole repo.
  return join(".data", "instance.key");
}

function materialFromPassphrase(raw: string): Buffer {
  const trimmed = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return Buffer.from(trimmed, "hex");
  return createHash("sha256").update(trimmed, "utf8").digest();
}

function loadOrCreateKey(): Buffer {
  const env = process.env.INSTANCE_ENCRYPTION_KEY?.trim();
  if (env) return materialFromPassphrase(env);

  if (isHostedRuntime()) {
    throw new Error("INSTANCE_ENCRYPTION_KEY is required on hosted runtimes.");
  }

  const file = keyFilePath();
  if (existsSync(file)) {
    return materialFromPassphrase(readFileSync(file, "utf8"));
  }
  mkdirSync(dirname(file), { recursive: true });
  const generated = randomBytes(32).toString("hex");
  writeFileSync(file, generated, { encoding: "utf8", mode: 0o600 });
  return Buffer.from(generated, "hex");
}

export function isEncryptedSecret(value: string | null | undefined): boolean {
  return Boolean(value && value.startsWith(PREFIX));
}

export function encryptSecret(plain: string | null | undefined): string | null {
  if (plain == null || plain === "") return plain ?? null;
  if (isEncryptedSecret(plain)) return plain;
  const key = loadOrCreateKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64url")}.${tag.toString("base64url")}.${enc.toString("base64url")}`;
}

export function decryptSecret(value: string | null | undefined): string | null {
  if (value == null || value === "") return value ?? null;
  if (!isEncryptedSecret(value)) return value;
  const payload = value.slice(PREFIX.length);
  const [ivB64, tagB64, dataB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !dataB64) return value;
  const key = loadOrCreateKey();
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64url")),
    decipher.final(),
  ]);
  return dec.toString("utf8");
}
