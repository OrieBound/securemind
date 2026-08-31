import Groq from "groq-sdk";

export async function transcribeWithGroq(apiKey: string, file: File): Promise<string> {
  const groq = new Groq({ apiKey });
  const result = await groq.audio.transcriptions.create({
    file,
    model: "whisper-large-v3-turbo",
    language: "en",
    response_format: "json",
    temperature: 0,
  });
  return result.text ?? "";
}
