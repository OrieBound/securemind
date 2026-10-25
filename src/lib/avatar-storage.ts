/**
 * Per-user avatar bytes.
 *
 * Local / on-prem: disk under AVATAR_STORAGE_PATH, or a sibling of DOCUMENT_STORAGE_PATH
 * (Docker uses /data/avatars next to /data/uploads). Host dev default is `.data/avatars`.
 * Hosted AWS: private S3 object when AVATAR_S3_BUCKET is set (Lambda IAM, no UI keys).
 * The browser never talks to S3 — it only hits /api/me/avatar.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import type { AvatarImageKind, AvatarMeta } from "@/lib/avatar-image";
import { isHostedRuntime } from "@/lib/runtime-env";
import {
  s3HeadAvatar,
  s3ReadAvatar,
  s3RemoveAvatar,
  s3WriteAvatar,
} from "@/lib/avatar-s3";

export type { AvatarMeta };

export function avatarS3Bucket(): string | undefined {
  const raw = process.env.AVATAR_S3_BUCKET?.trim();
  return raw && raw.length > 0 ? raw : undefined;
}

export function avatarObjectKey(userId: string): string {
  return `avatars/${safeSegment(userId)}/avatar`;
}

/** Disk root for local and on-prem photos. Hosted installs use S3 instead. */
export function avatarDiskRoot(): string {
  const configured = process.env.AVATAR_STORAGE_PATH?.trim();
  if (configured && configured.length > 0) return resolve(configured);
  const documents = process.env.DOCUMENT_STORAGE_PATH?.trim();
  if (documents) return resolve(documents, "..", "avatars");
  if (process.env.SECUREMIND_RUNTIME === "docker") return resolve("/data/avatars");
  return resolve(join(".data", "avatars"));
}

function storageRoot(): string {
  return avatarDiskRoot();
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "user";
}

function userDir(userId: string): string {
  const root = storageRoot();
  const abs = resolve(root, safeSegment(userId));
  if (!abs.startsWith(root + sep) && abs !== root) {
    throw new Error("Invalid avatar path");
  }
  return abs;
}

function bytesPath(userId: string): string {
  return join(userDir(userId), "avatar");
}

function metaPath(userId: string): string {
  return join(userDir(userId), "meta.json");
}

function parseMeta(raw: string): AvatarMeta | null {
  try {
    const parsed = JSON.parse(raw) as AvatarMeta;
    if (parsed?.contentType !== "image/jpeg" && parsed?.contentType !== "image/png") return null;
    if (typeof parsed.updatedAt !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

function diskReadMeta(userId: string): AvatarMeta | null {
  try {
    if (!existsSync(bytesPath(userId)) || !existsSync(metaPath(userId))) return null;
    return parseMeta(readFileSync(metaPath(userId), "utf8"));
  } catch {
    return null;
  }
}

function diskRead(userId: string): { bytes: Buffer; meta: AvatarMeta } | null {
  const meta = diskReadMeta(userId);
  if (!meta) return null;
  try {
    return { bytes: readFileSync(bytesPath(userId)), meta };
  } catch {
    return null;
  }
}

function diskWrite(userId: string, bytes: Buffer, contentType: AvatarImageKind): AvatarMeta {
  const dest = bytesPath(userId);
  try {
    mkdirSync(dirname(dest), { recursive: true });
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? String((err as { code: string }).code) : "";
    if (code === "EACCES" || code === "EPERM" || code === "EROFS") {
      const denied = new Error("Profile photos cannot be stored on this machine.");
      Object.assign(denied, { status: 503 });
      throw denied;
    }
    throw err;
  }
  const meta: AvatarMeta = { contentType, updatedAt: new Date().toISOString() };
  try {
    writeFileSync(dest, bytes, { mode: 0o600 });
    writeFileSync(metaPath(userId), JSON.stringify(meta), { encoding: "utf8", mode: 0o600 });
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? String((err as { code: string }).code) : "";
    if (code === "EACCES" || code === "EPERM" || code === "EROFS") {
      const denied = new Error("Profile photos cannot be stored on this machine.");
      Object.assign(denied, { status: 503 });
      throw denied;
    }
    throw err;
  }
  return meta;
}

function diskRemove(userId: string): void {
  try {
    rmSync(bytesPath(userId), { force: true });
    rmSync(metaPath(userId), { force: true });
  } catch {
    /* ignore */
  }
}

export async function readAvatarMeta(userId: string): Promise<AvatarMeta | null> {
  const bucket = avatarS3Bucket();
  if (bucket) return s3HeadAvatar(bucket, avatarObjectKey(userId));
  return diskReadMeta(userId);
}

export async function readAvatar(userId: string): Promise<{ bytes: Buffer; meta: AvatarMeta } | null> {
  const bucket = avatarS3Bucket();
  if (bucket) return s3ReadAvatar(bucket, avatarObjectKey(userId));
  return diskRead(userId);
}

export async function writeAvatar(
  userId: string,
  bytes: Buffer,
  contentType: AvatarImageKind,
): Promise<AvatarMeta> {
  const bucket = avatarS3Bucket();
  if (bucket) {
    return s3WriteAvatar(bucket, avatarObjectKey(userId), bytes, contentType);
  }
  if (isHostedRuntime()) {
    const err = new Error("Avatar object store is not configured for this install.");
    Object.assign(err, { status: 503 });
    throw err;
  }
  return diskWrite(userId, bytes, contentType);
}

export async function removeAvatar(userId: string): Promise<void> {
  const bucket = avatarS3Bucket();
  if (bucket) {
    await s3RemoveAvatar(bucket, avatarObjectKey(userId));
    return;
  }
  diskRemove(userId);
}

export async function resolveAvatarPublicUrl(userId: string): Promise<string | null> {
  try {
    const meta = await readAvatarMeta(userId);
    if (!meta) return null;
    return `/api/me/avatar?v=${encodeURIComponent(meta.updatedAt)}`;
  } catch (err) {
    // A photo-store miss must not blank the rest of the profile.
    console.warn("[avatar] meta lookup failed", err instanceof Error ? err.message : err);
    return null;
  }
}

/** @deprecated use resolveAvatarPublicUrl — sync disk-only hint for tests */
export function avatarPublicUrl(userId: string): string | null {
  const meta = diskReadMeta(userId);
  if (!meta) return null;
  return `/api/me/avatar?v=${encodeURIComponent(meta.updatedAt)}`;
}
