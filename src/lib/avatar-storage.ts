/**
 * Per-user avatar bytes on disk — same idea as Knowledge originals.
 * Paths are derived from userId only. Not S3 (local / on-prem default).
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import type { AvatarImageKind } from "@/lib/avatar-image";

export type AvatarMeta = {
  contentType: AvatarImageKind;
  updatedAt: string;
};

function storageRoot(): string {
  const configured = process.env.AVATAR_STORAGE_PATH?.trim();
  if (configured && configured.length > 0) return resolve(configured);
  return resolve(join(".data", "avatars"));
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

export function readAvatarMeta(userId: string): AvatarMeta | null {
  try {
    if (!existsSync(bytesPath(userId)) || !existsSync(metaPath(userId))) return null;
    const parsed = JSON.parse(readFileSync(metaPath(userId), "utf8")) as AvatarMeta;
    if (parsed?.contentType !== "image/jpeg" && parsed?.contentType !== "image/png") return null;
    if (typeof parsed.updatedAt !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function avatarExists(userId: string): boolean {
  return readAvatarMeta(userId) !== null;
}

export function readAvatar(userId: string): { bytes: Buffer; meta: AvatarMeta } | null {
  const meta = readAvatarMeta(userId);
  if (!meta) return null;
  try {
    return { bytes: readFileSync(bytesPath(userId)), meta };
  } catch {
    return null;
  }
}

export function writeAvatar(userId: string, bytes: Buffer, contentType: AvatarImageKind): AvatarMeta {
  const dest = bytesPath(userId);
  mkdirSync(dirname(dest), { recursive: true });
  const meta: AvatarMeta = { contentType, updatedAt: new Date().toISOString() };
  writeFileSync(dest, bytes, { mode: 0o600 });
  writeFileSync(metaPath(userId), JSON.stringify(meta), { encoding: "utf8", mode: 0o600 });
  return meta;
}

export function removeAvatar(userId: string): void {
  try {
    rmSync(bytesPath(userId), { force: true });
    rmSync(metaPath(userId), { force: true });
  } catch {
    /* ignore */
  }
}

export function avatarPublicUrl(userId: string): string | null {
  const meta = readAvatarMeta(userId);
  if (!meta) return null;
  return `/api/me/avatar?v=${encodeURIComponent(meta.updatedAt)}`;
}
