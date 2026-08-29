-- Additive turn-policy telemetry on InferenceEvent (no prompt/chunk content).

ALTER TABLE "InferenceEvent" ADD COLUMN "turnMode" TEXT;
ALTER TABLE "InferenceEvent" ADD COLUMN "retrievalAttempted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "InferenceEvent" ADD COLUMN "retrievalReasonCode" TEXT;
ALTER TABLE "InferenceEvent" ADD COLUMN "candidateCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "InferenceEvent" ADD COLUMN "evidenceCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "InferenceEvent" ADD COLUMN "sourcesCited" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "InferenceEvent" ADD COLUMN "retrievalMs" INTEGER;
ALTER TABLE "InferenceEvent" ADD COLUMN "insufficientEvidence" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "InferenceEvent" ADD COLUMN "attachmentUsed" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "InferenceEvent_userId_turnMode_idx" ON "InferenceEvent"("userId", "turnMode");
