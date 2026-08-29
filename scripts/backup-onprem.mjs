#!/usr/bin/env node
/**
 * On-prem logical backup. Writes backups/securemind-<iso>.sql via pg_dump
 * when the client is available; otherwise prints the Compose command.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const outDir = resolve(process.cwd(), "backups");
mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const dest = resolve(outDir, `securemind-${stamp}.sql`);

function which(bin) {
  try {
    execFileSync(process.platform === "win32" ? "where" : "which", [bin], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

if (which("pg_dump")) {
  const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error("Set DATABASE_URL or DIRECT_URL.");
    process.exit(1);
  }
  execFileSync("pg_dump", ["--no-owner", "--no-acl", "-d", url, "-f", dest], { stdio: "inherit" });
  console.log(`Wrote ${dest}`);
  process.exit(0);
}

if (existsSync(resolve(process.cwd(), "docker-compose.yml"))) {
  console.log("pg_dump is not on PATH. From this repo run:\n");
  console.log("  docker compose exec db pg_dump -U securemind -d securemind --no-owner --no-acl > backups/securemind.sql");
  console.log(`\nSuggested filename: ${dest}`);
  process.exit(0);
}

console.error("Neither pg_dump nor docker compose is available.");
process.exit(1);
