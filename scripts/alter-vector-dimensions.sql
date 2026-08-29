-- Optional: when using Bedrock Titan Embed Text v2 (1024-d default).
-- Local Ollama nomic-embed-text stays on vector(768).
-- Run only after deciding cloud embeddings will not use 768-d.
--
--   psql "$DIRECT_URL" -f scripts/alter-vector-dimensions.sql

DROP INDEX IF EXISTS memory_fragment_embedding_idx;

ALTER TABLE "MemoryFragment"
  ALTER COLUMN embedding TYPE vector(1024)
  USING NULL;

-- Re-embed all document chunks after this change (status → processing → processDocument).

CREATE INDEX memory_fragment_embedding_idx
  ON "MemoryFragment"
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
