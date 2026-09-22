#!/usr/bin/env node
/**
 * One-shot bootstrap for docker compose on-prem stack.
 * Waits for Postgres + Floci + Ollama, applies schema, provisions Cognito, pulls models.
 */

import { createConnection } from "node:net";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const bootstrapDir = process.env.BOOTSTRAP_DIR || "/bootstrap";
const runtimeEnvFile = join(bootstrapDir, "runtime.env");

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://securemind:securemind@db:5432/securemind";
const DIRECT_URL = process.env.DIRECT_URL || DATABASE_URL;
const FLociEndpoint = (process.env.AWS_ENDPOINT_URL || "http://floci:4566").replace(/\/$/, "");
const OLLAMA_BASE = (process.env.OLLAMA_BASE_URL || "http://ollama:11434").replace(/\/$/, "");
const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text";
const CHAT_MODEL = process.env.OLLAMA_CHAT_MODEL || "llama3.2:3b";

function log(msg) {
  console.log(`[bootstrap] ${msg}`);
}

function waitForTcp(host, port, label, timeoutMs = 120_000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      if (Date.now() - started > timeoutMs) {
        reject(new Error(`${label} not ready at ${host}:${port} after ${timeoutMs}ms`));
        return;
      }
      const socket = createConnection({ host, port }, () => {
        socket.end();
        resolve();
      });
      socket.on("error", () => {
        socket.destroy();
        setTimeout(attempt, 1500);
      });
    };
    attempt();
  });
}

function run(cmd, args, extraEnv = {}) {
  const r = spawnSync(cmd, args, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, DIRECT_URL, DATABASE_URL, ...extraEnv },
    stdio: "inherit",
    shell: false,
  });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed (${r.status})`);
  }
}

function normalizeOllamaTag(tag) {
  return String(tag).trim().toLowerCase().replace(/:latest$/, "");
}

async function listOllamaTags() {
  const res = await fetch(`${OLLAMA_BASE}/api/tags`);
  if (!res.ok) {
    throw new Error(`Ollama list tags: HTTP ${res.status}`);
  }
  const data = await res.json();
  return (data.models ?? []).map(m => m.name).filter(Boolean);
}

async function pullOllamaModel(name) {
  log(`Pulling Ollama model: ${name} (first boot may take several minutes)`);
  const res = await fetch(`${OLLAMA_BASE}/api/pull`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, stream: true }),
  });
  if (!res.ok) {
    throw new Error(`Ollama pull ${name}: HTTP ${res.status}`);
  }
  const reader = res.body?.getReader();
  if (!reader) return;
  const dec = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const line of dec.decode(value).split("\n")) {
      if (!line.trim()) continue;
      try {
        const j = JSON.parse(line);
        if (j.status) process.stdout.write(`  ${j.status}\r`);
      } catch { /* ndjson */ }
    }
  }
  process.stdout.write("\n");
}

async function ensureOllamaModel(name) {
  const tags = await listOllamaTags();
  const have = new Set(tags.map(normalizeOllamaTag));
  if (have.has(normalizeOllamaTag(name))) {
    log(`Ollama already has ${name} — skip pull`);
    return;
  }
  await pullOllamaModel(name);
}

async function main() {
  log("Waiting for Postgres…");
  await waitForTcp("db", 5432, "Postgres");

  log("Waiting for Floci…");
  await waitForTcp("floci", 4566, "Floci");

  log("Waiting for Ollama…");
  await waitForTcp("ollama", 11434, "Ollama");

  log("Applying Prisma schema (db push)…");
  run("npx", ["prisma", "db", "push"]);

  log("Ensuring pgvector column…");
  run("npx", ["prisma", "db", "execute", "--file", "scripts/add-vector-embedding.sql"]);

  // Workspaces are created for the signed-in user by listWorkspaces().
  // Never run the destructive demo seed during an install or upgrade.

  log("Provisioning Floci Cognito…");
  const cognitoOut = join(root, "scripts", ".floci-cognito.env");
  run("node", ["scripts/floci-cognito-setup.mjs"], {
    AWS_ENDPOINT_URL: FLociEndpoint,
    OUT_FILE: cognitoOut,
  });

  // Copy dynamic Cognito env for the app container entrypoint.
  const cognitoBody = readFileSync(cognitoOut, "utf8");
  mkdirSync(bootstrapDir, { recursive: true });
  writeFileSync(runtimeEnvFile, cognitoBody, "utf8");
  chmodSync(runtimeEnvFile, 0o644);
  log(`Wrote ${runtimeEnvFile}`);

  await ensureOllamaModel(EMBED_MODEL);
  await ensureOllamaModel(CHAT_MODEL);

  log("Bootstrap complete.");
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
