#!/usr/bin/env node
/**
 * After `next build` on Amplify: shrink the WEB_COMPUTE package without
 * deleting `.next/standalone` (Amplify needs it to boot).
 *
 * Also strip repo files that NFT accidentally traces into standalone.
 * Amplify's run.sh symlinks every standalone root entry; a leaked
 * `amplify-compute-bundle-output` / `src` / docs tree makes compute try
 * recursive symlinks on a read-only FS and the origin returns HTTP 500.
 */

import { existsSync, readdirSync, rmSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const STANDALONE = path.join(ROOT, ".next", "standalone");

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
  "node_modules/tailwindcss",
  "node_modules/@tailwindcss",
];

/** Next standalone server needs these at the bundle root — nothing else. */
const STANDALONE_KEEP = new Set([
  "server.js",
  "package.json",
  "package-lock.json",
  "node_modules",
  ".next",
  "public",
  "prisma",
]);

rm(".next/cache");
rm(".next/trace");
walkUnlinkMaps(path.join(ROOT, ".next"));

for (const rel of BUILD_ONLY) {
  rm(rel);
  rm(path.join(".next/standalone", rel));
}

if (existsSync(STANDALONE)) {
  for (const name of readdirSync(STANDALONE)) {
    if (STANDALONE_KEEP.has(name)) continue;
    rm(path.join(".next/standalone", name));
    console.log(`amplify-prune-compute: dropped leaked standalone/${name}`);
  }
}

/**
 * Amplify's Next packager copies leftover files from the CodeBuild workspace
 * (not only standalone). Job 10 still shipped src/ + amplify-compute-bundle-output
 * after we pruned standalone, and run.sh then ln -sf those paths on a read-only FS.
 * Never do this on a laptop — it would delete the source tree.
 */
const WORKSPACE_KEEP = new Set([
  ".git",
  ".next",
  "node_modules",
  "package.json",
  "package-lock.json",
  "public",
  "prisma",
  ".env.production",
]);

function isAmplifyBuild() {
  return Boolean(process.env.CODEBUILD_BUILD_ID || process.env.AWS_APP_ID || process.env.AWS_COMMIT_ID);
}

if (isAmplifyBuild()) {
  for (const name of readdirSync(ROOT)) {
    if (WORKSPACE_KEEP.has(name)) continue;
    rm(name);
    console.log(`amplify-prune-compute: dropped workspace/${name}`);
  }
}

console.log("amplify-prune-compute: kept standalone; dropped cache, maps, build-only modules, leaked repo files");
