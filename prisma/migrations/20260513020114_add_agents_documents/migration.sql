/*
  Warnings:

  - You are about to drop the column `companionName` on the `Session` table. All the data in the column will be lost.
  - Added the required column `agentId` to the `Session` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "Session_userId_updatedAt_idx";

-- AlterTable
ALTER TABLE "Session" DROP COLUMN "companionName",
ADD COLUMN     "agentId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "Agent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL DEFAULT 'local',
    "name" TEXT NOT NULL DEFAULT 'Sage',
    "emoji" TEXT NOT NULL DEFAULT '🧠',
    "color" TEXT NOT NULL DEFAULT '#6366f1',
    "personality" TEXT,
    "preferredMode" TEXT NOT NULL DEFAULT 'Companion',
    "modelOverride" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentFact" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL DEFAULT 'local',
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.8,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentFact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL DEFAULT 'local',
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemoryFragment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL DEFAULT 'local',
    "agentId" TEXT,
    "documentId" TEXT,
    "sessionId" TEXT,
    "content" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'episodic',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemoryFragment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Agent_userId_updatedAt_idx" ON "Agent"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "AgentFact_agentId_idx" ON "AgentFact"("agentId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentFact_agentId_key_key" ON "AgentFact"("agentId", "key");

-- CreateIndex
CREATE INDEX "Document_userId_idx" ON "Document"("userId");

-- CreateIndex
CREATE INDEX "MemoryFragment_userId_agentId_idx" ON "MemoryFragment"("userId", "agentId");

-- CreateIndex
CREATE INDEX "MemoryFragment_userId_category_idx" ON "MemoryFragment"("userId", "category");

-- CreateIndex
CREATE INDEX "Session_userId_agentId_updatedAt_idx" ON "Session"("userId", "agentId", "updatedAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentFact" ADD CONSTRAINT "AgentFact_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryFragment" ADD CONSTRAINT "MemoryFragment_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryFragment" ADD CONSTRAINT "MemoryFragment_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
