-- Admin-owned sidebar portal name, phrase, and custom-logo timestamp.
-- Logo bytes stay on disk (local) or private S3 (hosted), not in this table.
ALTER TABLE "InstanceConfig" ADD COLUMN IF NOT EXISTS "portalName" TEXT;
ALTER TABLE "InstanceConfig" ADD COLUMN IF NOT EXISTS "portalTagline" TEXT;
ALTER TABLE "InstanceConfig" ADD COLUMN IF NOT EXISTS "portalLogoAt" TIMESTAMP(3);
