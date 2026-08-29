-- AlterTable InstanceConfig: default monthly cap + Owner pointer
ALTER TABLE "InstanceConfig" ADD COLUMN IF NOT EXISTS "defaultMonthlyCostCapUsd" DOUBLE PRECISION NOT NULL DEFAULT 10;
ALTER TABLE "InstanceConfig" ADD COLUMN IF NOT EXISTS "ownerUserId" TEXT;

-- AlterTable UserProfile: per-user monthly cost cap (null = unlimited)
ALTER TABLE "UserProfile" ADD COLUMN IF NOT EXISTS "monthlyCostCapUsd" DOUBLE PRECISION;

-- Backfill existing Cognito/app profiles to the product default; local Owner stays unlimited until set.
UPDATE "UserProfile" SET "monthlyCostCapUsd" = 10 WHERE "monthlyCostCapUsd" IS NULL AND "userId" <> 'local';
