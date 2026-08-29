-- SecureMind no longer accepts or stores AWS credentials.
-- Bedrock authenticates through the AWS SDK default provider chain instead.
-- Overwrite before dropping so the values do not linger in dead tuples.
UPDATE "InstanceConfig"
   SET "bedrockAccessKeyId" = NULL,
       "bedrockSecretAccessKey" = NULL
 WHERE "bedrockAccessKeyId" IS NOT NULL
    OR "bedrockSecretAccessKey" IS NOT NULL;

ALTER TABLE "InstanceConfig" DROP COLUMN IF EXISTS "bedrockAccessKeyId";
ALTER TABLE "InstanceConfig" DROP COLUMN IF EXISTS "bedrockSecretAccessKey";
