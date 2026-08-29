-- Instance-level provider settings (Admin-managed). Secrets stay server-side.
CREATE TABLE "InstanceConfig" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "primaryProvider" TEXT NOT NULL DEFAULT 'auto',
    "groqApiKey" TEXT,
    "bedrockAccessKeyId" TEXT,
    "bedrockSecretAccessKey" TEXT,
    "bedrockRegion" TEXT,
    "bedrockChatModel" TEXT,
    "externalRiskAckAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedByUserId" TEXT,

    CONSTRAINT "InstanceConfig_pkey" PRIMARY KEY ("id")
);
