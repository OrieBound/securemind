-- AlterTable
ALTER TABLE "InstanceConfig" ADD COLUMN IF NOT EXISTS "extraProviderKeys" JSONB;
