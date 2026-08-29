#!/usr/bin/env node
/**
 * After `next build` on Amplify: shrink the WEB_COMPUTE package without
 * deleting `.next/standalone` (Amplify needs it to boot).
 */

import { existsSync, readdirSync, rmSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

function rm(rel) {
  rmSync(path.join(ROOT, rel), { recursive: true, force: true });
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

const BUILD_ONLY = [
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
];

rm(".next/cache");
rm(".next/trace");
walkUnlinkMaps(path.join(ROOT, ".next"));

for (const rel of BUILD_ONLY) {
  rm(rel);
  rm(path.join(".next/standalone", rel));
}

console.log("amplify-prune-compute: kept standalone; dropped cache, maps, and build-only modules");
