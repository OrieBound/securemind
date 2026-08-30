// Prisma client singleton — prevents multiple instances during Next.js hot reload.
// Prisma 7 requires an explicit adapter; DATABASE_URL is no longer auto-read.
// Bump PRISMA_SCHEMA_EPOCH after schema changes so dev HMR picks up a fresh client.
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { isHostedRuntime } from "@/lib/runtime-env";

const PRISMA_SCHEMA_EPOCH = "2026-08-23-knowledge-memory";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaEpoch?: string;
};

function createClient() {
  if (isHostedRuntime()) {
    throw new Error(
      "Hosted SecureMind does not use Postgres. Workspaces, chat history, and Knowledge vectors use DynamoDB.",
    );
  }
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set.");
  }
  const pool    = new Pool({ connectionString });
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

/** Lazy so Amplify SSR can boot without opening Postgres on import. */
export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, _receiver) {
    const client = getClient();
    const value = Reflect.get(client, prop, client) as unknown;
    if (typeof value === "function") {
      return (value as (...args: unknown[]) => unknown).bind(client);
    }
    return value;
  },
});