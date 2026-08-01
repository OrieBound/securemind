import { config } from "dotenv";
// Next.js stores secrets in .env.local — load it explicitly for the Prisma CLI
config({ path: ".env.local" });
config(); // fallback to .env if present
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  // DIRECT_URL used for migrations (bypasses the connection pooler)
  // DATABASE_URL (pooled) is passed to PrismaClient at runtime in src/lib/db.ts
  datasource: {
    url: process.env["DIRECT_URL"],
  },
});
