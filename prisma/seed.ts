/**
 * Seed script — populates the database with sample operational workspaces.
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
  await db.userFact.deleteMany({ where: { userId: "local" } });
  await db.workspace.deleteMany({ where: { userId: "local" } });

  const payments = await db.workspace.create({
    data: {
      userId:      "local",
      name:        "Production Payments",
      emoji:       "💳",
      color:       "#6366f1",
      description: "Stripe, PCI-scoped services, settlement",
      context:
        "Covers the production payment processing stack: Stripe integration, " +
        "PCI-scoped infrastructure, settlement jobs, and related runbooks.",
      isDefault: true,
    },
  });

  const session1 = await db.session.create({
    data: {
      userId:      "local",
      workspaceId: payments.id,
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
        "Investigating authentication failures after a production payments deploy. " +
        "Suspects include JWT audience mismatch, incomplete secret rotation, and readiness probe changes.",
      turnsCovered: 2,
    },
  });

  const portal = await db.workspace.create({
    data: {
      userId:      "local",
      name:        "Customer Portal",
      emoji:       "🌐",
      color:       "#0ea5e9",
      description: "Public portal, CDN, Cognito",
      context:
        "Customer-facing portal: CloudFront, Cognito user pools, API Gateway, " +
        "and the operational standards for public endpoints.",
      isDefault: false,
    },
  });

  await db.session.create({
    data: {
      userId:      "local",
      workspaceId: portal.id,
      title:       "CDN cache invalidation",
    },
  });

  await db.workspaceFact.createMany({
    data: [
      {
        workspaceId: payments.id,
        userId:      "local",
        key:         "primary_processor",
        value:       "Stripe",
        confidence:  1.0,
        source:      session1.id,
      },
      {
        workspaceId: payments.id,
        userId:      "local",
        key:         "scope",
        value:       "PCI",
        confidence:  0.9,
        source:      session1.id,
      },
    ],
  });

  console.log("Seed complete!");
  console.log(`   Workspaces: 2 (${payments.name}, ${portal.name})`);
  console.log("   Sessions:   2");
  console.log("   Messages:   2");
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
