#!/usr/bin/env node
/**
 * Create the SecureMind fragments table on local Floci ($0, no AWS account).
 *
 * Prerequisites: docker compose up -d floci
 *
 * Usage: npm run floci:dynamodb
 *
 * Floci supports Put/Query, not SearchVectors. The app falls back to in-process
 * cosine over the partition. Prints STORAGE_BACKEND / table env lines.
 */

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ENDPOINT = process.env.AWS_ENDPOINT_URL || "http://localhost:4566";
const REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";
const TABLE = process.env.DYNAMODB_FRAGMENTS_TABLE || "securemind-fragments";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outFile = process.env.OUT_FILE || join(root, "scripts", ".floci-dynamodb.env");

function aws(args) {
  const env = {
    ...process.env,
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID || "test",
    AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY || "test",
    AWS_DEFAULT_REGION: REGION,
    AWS_REGION: REGION,
    AWS_EC2_METADATA_DISABLED: "true",
  };
  const fullArgs = ["--endpoint-url", ENDPOINT, ...args];
  const r = spawnSync("aws", fullArgs, { encoding: "utf8", env, shell: false });
  if (r.status !== 0) {
    throw new Error(`aws ${fullArgs.join(" ")}\n${r.stderr || r.stdout}`);
  }
  return (r.stdout || "").trim();
}

function tableExists() {
  try {
    aws(["dynamodb", "describe-table", "--table-name", TABLE, "--output", "text"]);
    return true;
  } catch {
    return false;
  }
}

function main() {
  console.log(`Floci endpoint: ${ENDPOINT}`);
  console.log(`Table: ${TABLE}`);

  if (!tableExists()) {
    aws([
      "dynamodb",
      "create-table",
      "--table-name",
      TABLE,
      "--billing-mode",
      "PAY_PER_REQUEST",
      "--attribute-definitions",
      "AttributeName=workspaceId,AttributeType=S",
      "AttributeName=fragmentId,AttributeType=S",
      "--key-schema",
      "AttributeName=workspaceId,KeyType=HASH",
      "AttributeName=fragmentId,KeyType=RANGE",
      "--output",
      "text",
    ]);
    aws([
      "dynamodb",
      "wait",
      "table-exists",
      "--table-name",
      TABLE,
    ]);
    console.log("Created table (no VectorIndexes — Floci cannot SearchVectors).");
  } else {
    console.log("Table already exists.");
  }

  const lines = [
    `# Floci DynamoDB fragments (generated ${new Date().toISOString()})`,
    `AWS_ENDPOINT_URL=${ENDPOINT}`,
    `AWS_ACCESS_KEY_ID=test`,
    `AWS_SECRET_ACCESS_KEY=test`,
    `AWS_REGION=${REGION}`,
    `STORAGE_BACKEND=dynamodb`,
    `DYNAMODB_FRAGMENTS_TABLE=${TABLE}`,
    `# Keep Postgres for workspaces/chat/InstanceConfig:`,
    `# DATABASE_URL=postgresql://securemind:securemind@localhost:5432/securemind`,
  ];
  writeFileSync(outFile, `${lines.join("\n")}\n`, "utf8");
  console.log(`Wrote ${outFile}`);
  console.log("\nAdd to .env.local:\n");
  console.log(lines.filter((l) => !l.startsWith("#") || l.includes("DATABASE")).join("\n"));
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  console.error("\nIs Floci running?  docker compose up -d floci");
  process.exit(1);
}
