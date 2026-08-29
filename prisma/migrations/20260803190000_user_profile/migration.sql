-- CreateTable
CREATE TABLE "UserProfile" (
    "userId" TEXT NOT NULL,
    "email" TEXT,
    "displayName" TEXT,
    "handle" TEXT,
    "jobTitle" TEXT,
    "bio" TEXT,
    "timezone" TEXT,
    "locale" TEXT,
    "avatarPreset" TEXT NOT NULL DEFAULT 'shield',
    "themePreference" TEXT,
    "density" TEXT,
    "defaultLanding" TEXT,
    "defaultWorkspaceId" TEXT,
    "preferredModelId" TEXT,
    "notificationPrefs" JSONB,
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastSignInAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "deletedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserProfile_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserProfile_handle_key" ON "UserProfile"("handle");

-- CreateIndex
CREATE INDEX "UserProfile_status_idx" ON "UserProfile"("status");

-- CreateIndex
CREATE INDEX "UserProfile_email_idx" ON "UserProfile"("email");
