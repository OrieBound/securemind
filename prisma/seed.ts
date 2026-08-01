/**
 * Seed script — populates Neon with realistic sample data.
 * Run with: npx tsx prisma/seed.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool    = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const db      = new PrismaClient({ adapter });

async function main() {
  console.log("🌱 Seeding SecureMind database...");

  await db.agentFact.deleteMany({ where: { userId: "local" } });
  await db.userFact.deleteMany({  where: { userId: "local" } });
  await db.agent.deleteMany({     where: { userId: "local" } });

  // ── Default agent: Sage ──────────────────────────────────────────────────────
  const sage = await db.agent.create({
    data: {
      userId:        "local",
      name:          "Sage",
      emoji:         "🧠",
      color:         "#6366f1",
      personality:   "A calm, sharp, direct companion. Speaks casually, has real opinions, pushes back when something's off. Never sycophantic.",
      preferredMode: "Companion",
      isDefault:     true,
    },
  });

  // ── Session for Sage ─────────────────────────────────────────────────────────
  const session1 = await db.session.create({
    data: {
      userId:  "local",
      agentId: sage.id,
      title:   "Setting up SecureMind + Ollama",
      mode:    "Companion",
    },
  });

  await db.message.createMany({
    data: [
      { sessionId: session1.id, role: "assistant", content: "Hey — I'm Sage. What's on your mind?" },
      { sessionId: session1.id, role: "user",      content: "I just set this system up. My name is Orie and I'm 22." },
      { sessionId: session1.id, role: "assistant", content: "Nice. What are you building?" },
      { sessionId: session1.id, role: "user",      content: "A secure AI platform called SecureMind. Cloud architecture focus." },
      { sessionId: session1.id, role: "assistant", content: "That's a solid direction. Memory + security is actually underbuilt in the market." },
    ],
  });

  await db.sessionSummary.create({
    data: {
      sessionId:    session1.id,
      summary:      "User introduced themselves as Orie, age 22, building SecureMind — a secure adaptive AI platform with AWS architecture.",
      turnsCovered: 4,
    },
  });

  // ── Second agent ─────────────────────────────────────────────────────────────
  const nova = await db.agent.create({
    data: {
      userId:        "local",
      name:          "Nova",
      emoji:         "⚡",
      color:         "#f59e0b",
      personality:   "High-energy, fast, creative. Loves big ideas and unconventional thinking. Gets excited easily.",
      preferredMode: "Creative",
      isDefault:     false,
    },
  });

  await db.session.create({
    data: {
      userId:  "local",
      agentId: nova.id,
      title:   "Brainstorming",
      mode:    "Creative",
    },
  });

  // ── Agent facts for Sage ─────────────────────────────────────────────────────
  await db.agentFact.createMany({
    data: [
      { agentId: sage.id, userId: "local", key: "name",       value: "Orie",              confidence: 1.0, source: session1.id },
      { agentId: sage.id, userId: "local", key: "age",        value: "22",               confidence: 1.0, source: session1.id },
      { agentId: sage.id, userId: "local", key: "occupation", value: "Cloud architect",   confidence: 0.9, source: session1.id },
      { agentId: sage.id, userId: "local", key: "project",    value: "SecureMind",        confidence: 1.0, source: session1.id },
    ],
  });

  console.log("✅ Seed complete!");
  console.log(`   Agents:   2 (Sage, Nova)`);
  console.log(`   Sessions: 2`);
  console.log(`   Messages: 5`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
