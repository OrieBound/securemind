-- AlterTable
ALTER TABLE "InstanceConfig" ADD COLUMN IF NOT EXISTS "piiSensitivity" TEXT NOT NULL DEFAULT 'balanced';
ALTER TABLE "InstanceConfig" ADD COLUMN IF NOT EXISTS "safeTerms" JSONB;
ALTER TABLE "InstanceConfig" ADD COLUMN IF NOT EXISTS "pendingPiiSensitivity" TEXT;
ALTER TABLE "InstanceConfig" ADD COLUMN IF NOT EXISTS "pendingSafeTerms" JSONB;
ALTER TABLE "InstanceConfig" ADD COLUMN IF NOT EXISTS "pendingProposedByUserId" TEXT;
ALTER TABLE "InstanceConfig" ADD COLUMN IF NOT EXISTS "pendingProposedAt" TIMESTAMP(3);
ALTER TABLE "InstanceConfig" ADD COLUMN IF NOT EXISTS "pendingNote" TEXT;
