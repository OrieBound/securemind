-- AWS profile selection and the billable-call opt-in move into the app.
-- Neither is a credential: the profile is a pointer into the operator's
-- ~/.aws configuration, and the toggle is an admin-controlled safety gate.
ALTER TABLE "InstanceConfig" ADD COLUMN IF NOT EXISTS "awsProfile" TEXT;
ALTER TABLE "InstanceConfig" ADD COLUMN IF NOT EXISTS "allowRealAws" BOOLEAN NOT NULL DEFAULT false;
