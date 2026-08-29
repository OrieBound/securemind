#!/usr/bin/env node
/**
 * Bundle chat + warm Lambdas with esbuild (replaces SAM Metadata.BuildMethod).
 * Output: infra/terraform/.build/lambda/{chat,warm}.zip
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = path.join(ROOT, "infra/terraform/.build/lambda");
const STAGE = path.join(OUT, "_stage");

function fail(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    cwd: opts.cwd || ROOT,
    env: { ...process.env, ...opts.env },
  });
  if (r.status !== 0) fail(`${cmd} ${args.join(" ")} exited ${r.status}`);
}

function esbuildBin() {
  const name = process.platform === "win32" ? "esbuild.cmd" : "esbuild";
  const local = path.join(ROOT, "node_modules", ".bin", name);
  if (existsSync(local)) return local;
  fail("esbuild not found. Run npm install (esbuild is a devDependency).");
}

function zipDir(dir, zipPath) {
  if (existsSync(zipPath)) rmSync(zipPath, { force: true });
  if (process.platform === "win32") {
    run("powershell", [
      "-NoProfile",
      "-Command",
      `Compress-Archive -Path (Join-Path '${dir}' '*') -DestinationPath '${zipPath}' -Force`,
    ]);
    return;
  }
  run("zip", ["-r", "-q", zipPath, "."], { cwd: dir });
}

function bundle({ entry, outfile, withAlias }) {
  const args = [
    entry,
    "--bundle",
    "--platform=node",
    "--target=node22",
    "--format=cjs",
    `--outfile=${outfile}`,
    "--sourcemap",
    "--minify",
    "--external:@aws-sdk/*",
  ];
  if (withAlias) args.push(`--alias:@=${path.join(ROOT, "src")}`);
  run(esbuildBin(), args);
}

function main() {
  mkdirSync(OUT, { recursive: true });
  rmSync(STAGE, { recursive: true, force: true });
  mkdirSync(path.join(STAGE, "warm"), { recursive: true });
  mkdirSync(path.join(STAGE, "chat"), { recursive: true });

  console.log("Bundling warm Lambda…");
  bundle({
    entry: path.join(ROOT, "lambda/warm/handler.ts"),
    outfile: path.join(STAGE, "warm", "handler.js"),
    withAlias: false,
  });

  console.log("Bundling chat Lambda…");
  bundle({
    entry: path.join(ROOT, "lambda/chat/handler.ts"),
    outfile: path.join(STAGE, "chat", "handler.js"),
    withAlias: true,
  });

  zipDir(path.join(STAGE, "warm"), path.join(OUT, "warm.zip"));
  zipDir(path.join(STAGE, "chat"), path.join(OUT, "chat.zip"));
  console.log(`Wrote\n  ${path.join(OUT, "warm.zip")}\n  ${path.join(OUT, "chat.zip")}`);
}

main();
