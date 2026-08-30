/**
 * Local original-file store. Bytes never go in Postgres.
 * Paths are always derived from userId + documentId — never from a client path.
 */

import { createWriteStream, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import type { SpreadsheetTable } from "@/lib/spreadsheet/types";

function storageRoot(): string {
  const configured = process.env.DOCUMENT_STORAGE_PATH?.trim();
  if (configured && configured.length > 0) return resolve(configured);
  // Relative path only — process.cwd() makes Turbopack NFT-trace the whole repo.
  return join(".data", "uploads");
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "file";
}

export function buildStorageKey(userId: string, documentId: string, filename: string): string {
  const ext = filename.includes(".") ? filename.slice(filename.lastIndexOf(".")) : "";
  return [safeSegment(userId), safeSegment(documentId), `original${safeSegment(ext)}`].join("/");
}

function resolveKey(storageKey: string): string {
  const root = storageRoot();
  const abs = resolve(root, storageKey);
  if (!abs.startsWith(root + sep) && abs !== root) {
    throw new Error("Invalid storage key");
  }
  return abs;
}

export async function writeOriginal(opts: {
  userId: string;
  documentId: string;
  filename: string;
  buffer: Buffer;
}): Promise<string> {
  const key = buildStorageKey(opts.userId, opts.documentId, opts.filename);
  const dest = resolveKey(key);
  mkdirSync(dirname(dest), { recursive: true });
  await pipeline(Readable.from(opts.buffer), createWriteStream(dest, { mode: 0o600 }));
  return key;
}

export async function readOriginal(storageKey: string): Promise<Buffer> {
  return readFile(resolveKey(storageKey));
}

export function originalExists(storageKey: string | null | undefined): boolean {
  if (!storageKey) return false;
  try {
    return existsSync(resolveKey(storageKey));
  } catch {
    return false;
  }
}

export function removeOriginal(storageKey: string | null | undefined): void {
  if (!storageKey) return;
  try {
    rmSync(resolveKey(storageKey), { force: true });
    rmSync(resolveKey(`${storageKey}.tables.json`), { force: true });
  } catch {
    /* ignore missing files */
  }
}

export function writeSpreadsheetTables(storageKey: string, tables: SpreadsheetTable[]): void {
  const dest = resolveKey(`${storageKey}.tables.json`);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, JSON.stringify(tables), { encoding: "utf8", mode: 0o600 });
}

export async function readSpreadsheetTables(storageKey: string): Promise<SpreadsheetTable[] | null> {
  try {
    const raw = await readFile(resolveKey(`${storageKey}.tables.json`), "utf8");
    const parsed = JSON.parse(raw) as SpreadsheetTable[];
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
