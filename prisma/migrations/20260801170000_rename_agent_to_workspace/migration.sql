-- Rename Agent to Workspace and drop the personality system.
--
-- Written by hand rather than generated. Prisma's default diff for a model
-- rename is DROP TABLE + CREATE TABLE, which would destroy existing
-- conversations, facts, documents, and embeddings. Every statement here is a
-- rename or a targeted column drop, so all row data survives.

-- ── Tables ───────────────────────────────────────────────────────────────────
ALTER TABLE "Agent"     RENAME TO "Workspace";
ALTER TABLE "AgentFact" RENAME TO "WorkspaceFact";

-- ── Foreign key columns ──────────────────────────────────────────────────────
ALTER TABLE "Session"        RENAME COLUMN "agentId" TO "workspaceId";
ALTER TABLE "WorkspaceFact"  RENAME COLUMN "agentId" TO "workspaceId";
ALTER TABLE "Document"       RENAME COLUMN "agentId" TO "workspaceId";
ALTER TABLE "MemoryFragment" RENAME COLUMN "agentId" TO "workspaceId";

-- ── Repurpose the personality columns ────────────────────────────────────────
-- "personality" held a compiled personality prompt injected into the system
-- prompt. It becomes "context": a description of what the workspace covers,
-- which is injected at the same point and serves a defensible purpose.
ALTER TABLE "Workspace" RENAME COLUMN "personality" TO "context";
ALTER TABLE "Workspace" RENAME COLUMN "tagline"     TO "description";

-- Trait sliders and the per-workspace conversation mode are gone. Model choice
-- is decided per message by the complexity router, not stored on the session.
ALTER TABLE "Workspace" DROP COLUMN "personalityConfig";
ALTER TABLE "Workspace" DROP COLUMN "preferredMode";
ALTER TABLE "Session"   DROP COLUMN "mode";

-- ── Defaults ─────────────────────────────────────────────────────────────────
ALTER TABLE "Workspace" ALTER COLUMN "name"  SET DEFAULT 'General';
ALTER TABLE "Workspace" ALTER COLUMN "emoji" SET DEFAULT '🗂️';

-- ── Constraints ──────────────────────────────────────────────────────────────
-- Renaming a table does not rename its constraints or indexes, and Prisma
-- derives expected names from the model, so these must be renamed explicitly
-- or every later migration will show spurious drift.
ALTER TABLE "Workspace"      RENAME CONSTRAINT "Agent_pkey"                  TO "Workspace_pkey";
ALTER TABLE "WorkspaceFact"  RENAME CONSTRAINT "AgentFact_pkey"              TO "WorkspaceFact_pkey";
ALTER TABLE "WorkspaceFact"  RENAME CONSTRAINT "AgentFact_agentId_fkey"      TO "WorkspaceFact_workspaceId_fkey";
ALTER TABLE "Session"        RENAME CONSTRAINT "Session_agentId_fkey"        TO "Session_workspaceId_fkey";
ALTER TABLE "Document"       RENAME CONSTRAINT "Document_agentId_fkey"       TO "Document_workspaceId_fkey";
ALTER TABLE "MemoryFragment" RENAME CONSTRAINT "MemoryFragment_agentId_fkey" TO "MemoryFragment_workspaceId_fkey";

-- ── Indexes ──────────────────────────────────────────────────────────────────
ALTER INDEX "Agent_userId_updatedAt_idx"           RENAME TO "Workspace_userId_updatedAt_idx";
ALTER INDEX "AgentFact_agentId_idx"                RENAME TO "WorkspaceFact_workspaceId_idx";
ALTER INDEX "AgentFact_agentId_key_key"            RENAME TO "WorkspaceFact_workspaceId_key_key";
ALTER INDEX "Document_userId_agentId_idx"          RENAME TO "Document_userId_workspaceId_idx";
ALTER INDEX "MemoryFragment_userId_agentId_idx"    RENAME TO "MemoryFragment_userId_workspaceId_idx";
ALTER INDEX "Session_userId_agentId_updatedAt_idx" RENAME TO "Session_userId_workspaceId_updatedAt_idx";
