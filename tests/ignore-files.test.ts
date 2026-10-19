import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8").split(/\r?\n/).map(l => l.trim());

// Things that must never be committed or enter a Docker build context. If one of these rules is
// removed, a fresh clone could publish state files, credentials or assistant folders.
const MUST_IGNORE = [".env*", "*.tfstate", "*.tfvars", ".claude/", "**/.terraform/", "*.dump", "*.pem", "*.key", "/backups/", "/.data/", "*.log", "*.bak"];
const MUST_KEEP_TRACKED = ["!.env.example", "!.env.onprem.example", "!*.tfvars.example"];
const DOCKER_MUST_EXCLUDE = [".env", "*.tfvars", "*.dump", ".claude", ".aws", ".data", "backups", "infra"];

describe(".gitignore", () => {
  const rules = read(".gitignore");
  it.each(MUST_IGNORE)("ignores %s", rule => expect(rules).toContain(rule));
  it.each(MUST_KEEP_TRACKED)("keeps the example files tracked: %s", rule => expect(rules).toContain(rule));
});

describe(".dockerignore", () => {
  const rules = read(".dockerignore");
  it.each(DOCKER_MUST_EXCLUDE)("excludes %s from the build context", rule => expect(rules).toContain(rule));
});
