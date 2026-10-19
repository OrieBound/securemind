/**
 * Instance portal mark.
 *
 * Local / on-prem: disk under PORTAL_STORAGE_PATH, or a sibling of DOCUMENT_STORAGE_PATH
 * (Docker uses /data/portal next to /data/uploads). Host dev default is `.data/portal`.
 * Hosted AWS: private S3 object in the avatar bucket (Lambda IAM, no UI keys).
 * The browser never talks to S3 — it only hits /api/settings/portal/logo.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import type { AvatarImageKind, AvatarMeta } from "@/lib/avatar-image";
import { avatarS3Bucket } from "@/lib/avatar-storage";
import { s3ReadAvatar, s3RemoveAvatar, s3WriteAvatar } from "@/lib/avatar-s3";
import { isHostedRuntime } from "@/lib/runtime-env";

const OBJECT_KEY = "portal/logo";

export function portalDiskRoot(): string {
  const configured = process.env.PORTAL_STORAGE_PATH?.trim();
  if (configured && configured.length > 0) return resolve(configured);
  const documents = process.env.DOCUMENT_STORAGE_PATH?.trim();
  if (documents) return resolve(documents, "..", "portal");
  if (process.env.SECUREMIND_RUNTIME === "docker") return resolve("/data/portal");
  return resolve(join(".data", "portal"));
}

function bytesPath(): string {
  return assertInside(join(portalDiskRoot(), "logo"));
}

function metaPath(): string {
  return assertInside(join(portalDiskRoot(), "meta.json"));
}

function assertInside(abs: string): string {
  const root = portalDiskRoot();
  const resolved = resolve(abs);
  if (resolved !== root && !resolved.startsWith(root + sep)) {
    throw new Error("Invalid portal logo path");
  }
  return resolved;
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

function diskRead(): { bytes: Buffer; meta: AvatarMeta } | null {
  try {
    if (!existsSync(bytesPath()) || !existsSync(metaPath())) return null;
    const meta = parseMeta(readFileSync(metaPath(), "utf8"));
    if (!meta) return null;
    return { bytes: readFileSync(bytesPath()), meta };
  } catch {
    return null;
  }
}

function storageDenied(err: unknown): boolean {
  const code = err && typeof err === "object" && "code" in err ? String((err as { code: string }).code) : "";
  return code === "EACCES" || code === "EPERM" || code === "EROFS";
}

function diskWrite(bytes: Buffer, contentType: AvatarImageKind): AvatarMeta {
  const dest = bytesPath();
  try {
    mkdirSync(dirname(dest), { recursive: true });
  } catch (err) {
    if (storageDenied(err)) {
      const denied = new Error("The portal logo cannot be stored on this machine.");
      Object.assign(denied, { status: 503 });
      throw denied;
    }
    throw err;
  }
  const meta: AvatarMeta = { contentType, updatedAt: new Date().toISOString() };
  try {
    writeFileSync(dest, bytes, { mode: 0o600 });
    writeFileSync(metaPath(), JSON.stringify(meta), { encoding: "utf8", mode: 0o600 });
  } catch (err) {
    if (storageDenied(err)) {
      const denied = new Error("The portal logo cannot be stored on this machine.");
      Object.assign(denied, { status: 503 });
      throw denied;
    }
    throw err;
  }
  return meta;
}

function diskRemove(): void {
  try {
    rmSync(bytesPath(), { force: true });
    rmSync(metaPath(), { force: true });
  } catch {
    /* ignore */
  }
}

export async function readPortalLogo(): Promise<{ bytes: Buffer; meta: AvatarMeta } | null> {
  const bucket = avatarS3Bucket();
  if (bucket) return s3ReadAvatar(bucket, OBJECT_KEY);
  return diskRead();
}

export async function writePortalLogo(
  bytes: Buffer,
  contentType: AvatarImageKind,
): Promise<AvatarMeta> {
  const bucket = avatarS3Bucket();
  if (bucket) return s3WriteAvatar(bucket, OBJECT_KEY, bytes, contentType);
  if (isHostedRuntime()) {
    const err = new Error("Portal logo storage is not configured for this install.");
    Object.assign(err, { status: 503 });
    throw err;
  }
  return diskWrite(bytes, contentType);
}

export async function removePortalLogo(): Promise<void> {
  const bucket = avatarS3Bucket();
  if (bucket) {
    await s3RemoveAvatar(bucket, OBJECT_KEY);
    return;
  }
  diskRemove();
}
