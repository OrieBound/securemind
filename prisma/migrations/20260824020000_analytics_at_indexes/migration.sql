-- Org-wide Admin / Insights range filters scan by `at` without userId.
CREATE INDEX IF NOT EXISTS "SecurityEvent_at_idx" ON "SecurityEvent"("at");
CREATE INDEX IF NOT EXISTS "InferenceEvent_at_idx" ON "InferenceEvent"("at");
