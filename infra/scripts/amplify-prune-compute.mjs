#!/usr/bin/env node
/**
 * After `next build` on Amplify: drop files that are not needed at SSR runtime.
 * Amplify WEB_COMPUTE counts uncompressed traced + `.next` output toward 220 MB.
 * Does not remove application API routes (hosted UI still calls them same-origin).
 */

import { existsSync, readdirSync, rmSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

function rm(rel) {
  const abs = path.join(ROOT, rel);
  rmSync(abs, { recursive: true, force: true });
}

function walkUnlinkMaps(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) walkUnlinkMaps(p);
    else if (name.endsWith(".map")) {
      try {
        unlinkSync(p);
      } catch {
        /* ignore */
      }
    }
  }
}

rm(".next/cache");
rm(".next/standalone");
rm(".next/trace");
walkUnlinkMaps(path.join(ROOT, ".next"));

for (const rel of [
  "node_modules/@swc",
  "node_modules/@esbuild",
  "node_modules/esbuild",
  "node_modules/@next/swc-linux-x64-gnu",
  "node_modules/@next/swc-linux-x64-musl",
  "node_modules/typescript",
  "node_modules/eslint",
  "node_modules/eslint-config-next",
  "node_modules/vitest",
  "node_modules/@vitest",
  "node_modules/happy-dom",
  "node_modules/@testing-library",
  "node_modules/shadcn",
  "node_modules/pdf-lib",
  "node_modules/prisma",
  "node_modules/tailwindcss",
  "node_modules/@tailwindcss",
]) {
  rm(rel);
}

console.log("amplify-prune-compute: dropped build-only trees under .next and node_modules");
