/**
 * Voice STT is opt-in. Nothing is sent until the operator picks Groq or
 * Amazon Transcribe and acknowledges that spoken audio leaves this host
 * before any text redaction.
 */

export type TranscribeBackend = "groq" | "transcribe";
export type VoiceSttChoice = "groq" | "transcribe";

export function parseVoiceSttChoice(raw: unknown): VoiceSttChoice | null {
  return raw === "groq" || raw === "transcribe" ? raw : null;
}

export function pickTranscribeBackend(opts: {
  edition: "local" | "cloud";
  groqOk: boolean;
  awsOk: boolean;
  choice?: VoiceSttChoice | null;
  audioAcked?: boolean;
}): TranscribeBackend | null {
  const choice = parseVoiceSttChoice(opts.choice);
  if (!choice || !opts.audioAcked) return null;
  if (choice === "groq") return opts.groqOk ? "groq" : null;
  return opts.awsOk ? "transcribe" : null;
}

export function transcribeUnavailableMessage(opts: {
  choice: VoiceSttChoice | null;
  groqOk: boolean;
  awsOk: boolean;
  audioAcked: boolean;
}): string {
  if (!opts.choice || !opts.audioAcked) {
    return (
      "Choose Groq Whisper or Amazon Transcribe the first time you use the microphone. " +
      "Spoken audio is sent to that vendor before any redaction."
    );
  }
  if (opts.choice === "groq" && !opts.groqOk) {
    return (
      "Groq Whisper is selected, but no Groq API key is stored. " +
      "Create a key at console.groq.com/keys and save it (Admin)."
    );
  }
  if (opts.choice === "transcribe" && !opts.awsOk) {
    return (
      "Amazon Transcribe is selected. Enable billable AWS in Settings → Providers " +
      "(same account as Bedrock). Transcribe is billed on that account."
    );
  }
  return "Transcription is not available.";
}
