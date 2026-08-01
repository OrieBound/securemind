// Prisma client singleton — prevents multiple instances during Next.js hot reload.
// Prisma 7 requires an explicit adapter; DATABASE_URL is no longer auto-read.
// Bump PRISMA_SCHEMA_EPOCH after schema changes so dev HMR picks up a fresh client.
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const PRISMA_SCHEMA_EPOCH = "2026-06-25-personality-config";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaEpoch?: string;
};

function createClient() {
  const pool    = new Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

function getClient(): PrismaClient {
  if (!globalForPrisma.prisma || globalForPrisma.prismaEpoch !== PRISMA_SCHEMA_EPOCH) {
    globalForPrisma.prisma = createClient();
    globalForPrisma.prismaEpoch = PRISMA_SCHEMA_EPOCH;
  }
  return globalForPrisma.prisma;
}

export const db = getClient();