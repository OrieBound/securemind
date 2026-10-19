-- Catch-up Document columns that landed via db push, plus Phase 2/3 fields.

ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'processing';
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "chunkCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "redactionCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "scrubEvents" JSONB;
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "storageKey" TEXT;
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "processingError" TEXT;
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "processedAt" TIMESTAMP(3);
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "extractMeta" JSONB;

CREATE INDEX IF NOT EXISTS "Document_userId_idx" ON "Document"("userId");
CREATE INDEX IF NOT EXISTS "Document_userId_workspaceId_idx" ON "Document"("userId", "workspaceId");
CREATE INDEX IF NOT EXISTS "Document_userId_status_idx" ON "Document"("userId", "status");

ALTER TABLE "MemoryFragment" ADD COLUMN IF NOT EXISTS "provenance" JSONB;

ALTER TABLE "WorkspaceFact" ADD COLUMN IF NOT EXISTS "pinned" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "WorkspaceFact" ADD COLUMN IF NOT EXISTS "forgotten" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "WorkspaceFact" ADD COLUMN IF NOT EXISTS "correctedAt" TIMESTAMP(3);
ALTER TABLE "WorkspaceFact" ADD COLUMN IF NOT EXISTS "correctedByUserId" TEXT;

CREATE TABLE IF NOT EXISTS "SavedItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "preview" TEXT NOT NULL,
    "role" TEXT,
    "heavy" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SavedItem_userId_workspaceId_messageId_key"
  ON "SavedItem"("userId", "workspaceId", "messageId");
CREATE INDEX IF NOT EXISTS "SavedItem_userId_workspaceId_createdAt_idx"
  ON "SavedItem"("userId", "workspaceId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'SavedItem_workspaceId_fkey'
  ) THEN
    ALTER TABLE "SavedItem"
      ADD CONSTRAINT "SavedItem_workspaceId_fkey"
      FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
