-- Opt-in speech-to-text provider (groq | transcribe) plus audio-leave acknowledgement.
ALTER TABLE "InstanceConfig" ADD COLUMN IF NOT EXISTS "voiceSttChoice" TEXT;
ALTER TABLE "InstanceConfig" ADD COLUMN IF NOT EXISTS "voiceSttAudioAckAt" TIMESTAMP(3);
