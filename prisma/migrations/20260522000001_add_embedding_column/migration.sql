-- Baseline migration: records the embedding column that was added via raw SQL
-- outside of migration history. Marking as applied resolves the drift.

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE "MemoryFragment" ADD COLUMN IF NOT EXISTS "embedding" vector(768);

CREATE INDEX IF NOT EXISTS "MemoryFragment_embedding_idx" ON "MemoryFragment" USING ivfflat ("embedding" vector_cosine_ops);
