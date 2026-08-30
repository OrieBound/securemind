-- First-run instance setup (claim used + wizard complete + storage preference).
ALTER TABLE "InstanceConfig" ADD COLUMN IF NOT EXISTS "setupCompletedAt" TIMESTAMP(3);
ALTER TABLE "InstanceConfig" ADD COLUMN IF NOT EXISTS "setupClaimUsedAt" TIMESTAMP(3);
ALTER TABLE "InstanceConfig" ADD COLUMN IF NOT EXISTS "storageBackend" TEXT;
