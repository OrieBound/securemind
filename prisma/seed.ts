/**
 * Seed script — populates the database with the default Mindy Locke workspace.
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
  console.log("Seeding SecureMind database...");

  await db.workspaceFact.deleteMany({ where: { userId: "local" } });
  await db.workspace.deleteMany({ where: { userId: "local" } });

  const mindy = await db.workspace.create({
    data: {
      userId:      "local",
      name:        "Mindy Locke",
      emoji:       "🛡️",
      color:       "#6366f1",
      description: "Runbooks, incidents, architecture, and operational knowledge.",
      context:
        "Default personal ops workspace: runbooks, incident notes, architecture " +
        "decisions, and operational knowledge used for evidence-grounded answers.",
      isDefault: true,
    },
  });

  const session1 = await db.session.create({
    data: {
      userId:      "local",
      workspaceId: mindy.id,
      title:       "Auth failures after deploy",
    },
  });

  await db.message.createMany({
    data: [
      {
        sessionId: session1.id,
        role:      "user",
        content:
          "What could explain the authentication failures that began after the latest deployment?",
      },
      {
        sessionId: session1.id,
        role:      "assistant",
        content:
          "Likely causes: a misconfigured JWT audience after the config change, " +
          "a secrets rotation that did not propagate to all pods, or a health-check " +
          "path that now fails the readiness probe. Check the deploy diff for auth " +
          "config and the last successful secret sync timestamp.",
      },
    ],
  });

  await db.sessionSummary.create({
    data: {
      sessionId:    session1.id,
      summary:
        "Investigating authentication failures after a deploy. " +
        "Suspects include JWT audience mismatch, incomplete secret rotation, and readiness probe changes.",
      turnsCovered: 2,
    },
  });

  await db.workspaceFact.createMany({
    data: [
      {
        workspaceId: mindy.id,
        userId:      "local",
        key:         "scope",
        value:       "ops knowledge + runbooks",
        confidence:  1.0,
        source:      session1.id,
      },
    ],
  });

  console.log("Seed complete!");
  console.log(`   Workspace: ${mindy.name}`);
  console.log("   Sessions:  1");
  console.log("   Messages:  2");
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
