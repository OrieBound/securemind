-- Default workspace identity: Aegis (speaker name in chat).
ALTER TABLE "Workspace" ALTER COLUMN "name" SET DEFAULT 'Aegis';
ALTER TABLE "Workspace" ALTER COLUMN "emoji" SET DEFAULT '🛡️';

-- Rename untouched prior default seed so existing local DBs pick up the new name.
UPDATE "Workspace"
SET
  "name" = 'Aegis',
  "emoji" = CASE WHEN "emoji" = '☁️' THEN '🛡️' ELSE "emoji" END,
  "description" = COALESCE(
    "description",
    'Runbooks, incidents, architecture, and operational knowledge.'
  )
WHERE "name" = 'Cloud Operations'
  AND "isDefault" = true;
