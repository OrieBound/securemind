-- SecureMind Phase B — pgvector setup
-- Run once against your Neon database:
--   npx prisma db execute --file scripts/add-vector-embedding.sql
-- Then regenerate the Prisma client:
--   npx prisma generate

-- Step 1: Enable pgvector extension (idempotent)
CREATE EXTENSION IF NOT EXISTS vector;

-- Step 2: Add 768-dimension embedding column to MemoryFragment
-- nomic-embed-text produces 768-dim vectors; change if you switch embed models
ALTER TABLE "MemoryFragment"
  ADD COLUMN IF NOT EXISTS embedding vector(768);

-- Step 3: ivfflat cosine index for fast retrieval
-- Only effective once you have >1 000 rows; safe to add now, unused until then
CREATE INDEX IF NOT EXISTS "MemoryFragment_embedding_cosine_idx"
  ON "MemoryFragment" USING ivfflat (embedding vector_cosine_ops) WITH (lists = 10);
