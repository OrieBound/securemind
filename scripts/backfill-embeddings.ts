/**
 * SecureMind — Phase B backfill script
 *
 * Embeds all existing assistant messages that don't yet have a MemoryFragment
 * so your historical conversations become semantically searchable immediately.
 *
 * Run once after applying the SQL migration:
 *   npx tsx scripts/backfill-embeddings.ts
 *
 * Requires:
 *   - Ollama running locally with nomic-embed-text pulled
 *   - DIRECT_URL (or DATABASE_URL) set in .env.local
 *   - pgvector extension enabled (scripts/add-vector-embedding.sql applied)
 *
 * The script is idempotent — re-running won't create duplicates because it
 * skips sessions that already have MemoryFragments of category "episodic".
 */

import "dotenv/config";
import { config } from "dotenv";
config({ path: ".env.local" });

import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";

const pool = new Pool({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const OLLAMA_BASE  = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const EMBED_MODEL  = process.env.OLLAMA_EMBED_MODEL ?? "nomic-embed-text";
const MIN_CHARS    = 60;    // skip very short assistant messages
const BATCH_DELAY  = 50;    // ms between embeds to avoid hammering Ollama

async function embedText(text: string): Promise<number[]> {
  const resp = await fetch(`${OLLAMA_BASE}/api/embeddings`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ model: EMBED_MODEL, prompt: text }),
  });
  if (!resp.ok) throw new Error(`Ollama embed ${resp.status}: ${await resp.text()}`);
  const data = await resp.json() as { embedding: number[] };
  return data.embedding;
}

function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log("SecureMind — backfill embeddings\n");

  // Find sessions that have no episodic MemoryFragments yet
  const sessions = await prisma.session.findMany({
    select: {
      id:      true,
      workspaceId: true,
      userId:  true,
    },
    where: {
      messages: { some: { role: "assistant" } },
    },
  });

  // For each session, check if fragments already exist
  const sessionsToProcess: typeof sessions = [];
  for (const s of sessions) {
    const existing = await prisma.memoryFragment.count({
      where: { sessionId: s.id, category: "episodic" },
    });
    if (existing === 0) sessionsToProcess.push(s);
  }

  console.log(`Sessions total: ${sessions.length}`);
  console.log(`Sessions to embed: ${sessionsToProcess.length}`);
  if (sessionsToProcess.length === 0) {
    console.log("Nothing to do — all sessions already have embeddings.");
    return;
  }

  let embedded = 0;
  let skipped  = 0;

  for (const session of sessionsToProcess) {
    // Get all assistant messages for this session
    const messages = await prisma.message.findMany({
      where:   { sessionId: session.id, role: "assistant" },
      orderBy: { createdAt: "asc" },
      select:  { id: true, content: true },
    });

    for (const msg of messages) {
      if (msg.content.length < MIN_CHARS) { skipped++; continue; }

      try {
        // Create fragment record
        const fragment = await prisma.memoryFragment.create({
          data: {
            userId:    session.userId,
            workspaceId:   session.workspaceId,
            sessionId: session.id,
            content:   msg.content,
            category:  "episodic",
          },
          select: { id: true },
        });

        // Attach embedding via raw SQL
        const vector    = await embedText(msg.content);
        const vectorStr = `[${vector.join(",")}]`;
        await prisma.$executeRawUnsafe(
          `UPDATE "MemoryFragment" SET embedding = $1::vector WHERE id = $2`,
          vectorStr,
          fragment.id,
        );

        embedded++;
        process.stdout.write(`\r  Embedded ${embedded} messages...`);
        await sleep(BATCH_DELAY);

      } catch (err) {
        console.error(`\n  Failed message ${msg.id}:`, String(err));
        skipped++;
      }
    }
  }

  console.log(`\n\nDone.`);
  console.log(`  Embedded: ${embedded}`);
  console.log(`  Skipped:  ${skipped} (too short or errors)`);
}

main()
  .catch(err => { console.error(err); process.exit(1); })
  .finally(() => Promise.all([prisma.$disconnect(), pool.end()]));
