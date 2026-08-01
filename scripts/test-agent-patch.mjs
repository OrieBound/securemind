/**
 * Smoke test: PATCH agent with personalityConfig (run after prisma generate).
 * Usage: node scripts/test-agent-patch.mjs [agentId]
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import { config } from "dotenv";

config({ path: ".env.local" });

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter: new PrismaPg(pool) });

const configPayload = {
  version: 1,
  archetypes: [{ id: "mentor", weight: 100 }],
  traits: {
    energy: 72, warmth: 60, empathy: 50, sensitivity: 50, patience: 70,
    directness: 58, formality: 30, verbosity: 65, humor: 45, politeness: 50,
    technical_depth: 60, creativity: 45, pushback: 50, structure: 80, flirtiness: 5,
  },
  voice: { tone: ["supportive", "clear"], humor: 45, verbosity: 65, emojiLevel: 25 },
  boundaries: { pushback: 50, sycophancy: 25 },
  freeform: "Test save from script.",
};

async function main() {
  let id = process.argv[2];
  if (!id) {
    const first = await db.agent.findFirst({ orderBy: { createdAt: "asc" } });
    if (!first) throw new Error("No agents in DB");
    id = first.id;
  }

  const updated = await db.agent.update({
    where: { id },
    data: {
      personalityConfig: configPayload,
      personality: "Test compiled personality.",
      tagline: "Mentor · test",
    },
  });

  console.log("PASS", updated.name, updated.tagline);
  await db.$disconnect();
  await pool.end();
}

main().catch(err => {
  console.error("FAIL", err.message);
  process.exit(1);
});
