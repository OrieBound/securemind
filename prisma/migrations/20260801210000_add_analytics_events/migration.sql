-- Additive analytics telemetry. Existing Workspace / Session / Message / Document
-- rows are untouched. SecurityEvent and InferenceEvent store sanitized metadata only.

-- AlterTable: default workspace naming for new rows
ALTER TABLE "Workspace" ALTER COLUMN "name" SET DEFAULT 'Cloud Operations';
ALTER TABLE "Workspace" ALTER COLUMN "emoji" SET DEFAULT '☁️';

-- Rename only untouched first-run defaults (exact name + stock description).
UPDATE "Workspace"
SET
  "name" = 'Cloud Operations',
  "emoji" = '☁️',
  "description" = 'Runbooks, incidents, architecture, and operational knowledge.'
WHERE "name" = 'General'
  AND ("description" IS NULL OR "description" = 'Default workspace');

-- CreateTable
CREATE TABLE "SecurityEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "riskLevel" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "sensitivity" TEXT,
    "resourceKind" TEXT,
    "resourceId" TEXT,

    CONSTRAINT "SecurityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InferenceEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "sessionId" TEXT,
    "messageId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "latencyMs" INTEGER,
    "status" TEXT NOT NULL,
    "retrievalHitCount" INTEGER NOT NULL DEFAULT 0,
    "citationCount" INTEGER NOT NULL DEFAULT 0,
    "groundingStatus" TEXT,
    "estimatedCostUsd" DOUBLE PRECISION,
    "pricingVersion" TEXT,

    CONSTRAINT "InferenceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SecurityEvent_userId_at_idx" ON "SecurityEvent"("userId", "at");
CREATE INDEX "SecurityEvent_userId_workspaceId_at_idx" ON "SecurityEvent"("userId", "workspaceId", "at");
CREATE INDEX "SecurityEvent_userId_category_idx" ON "SecurityEvent"("userId", "category");
CREATE INDEX "SecurityEvent_userId_outcome_idx" ON "SecurityEvent"("userId", "outcome");
CREATE INDEX "SecurityEvent_userId_source_idx" ON "SecurityEvent"("userId", "source");

CREATE INDEX "InferenceEvent_userId_at_idx" ON "InferenceEvent"("userId", "at");
CREATE INDEX "InferenceEvent_userId_workspaceId_at_idx" ON "InferenceEvent"("userId", "workspaceId", "at");
CREATE INDEX "InferenceEvent_userId_model_idx" ON "InferenceEvent"("userId", "model");
CREATE INDEX "InferenceEvent_userId_groundingStatus_idx" ON "InferenceEvent"("userId", "groundingStatus");

-- AddForeignKey
ALTER TABLE "SecurityEvent" ADD CONSTRAINT "SecurityEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InferenceEvent" ADD CONSTRAINT "InferenceEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;
