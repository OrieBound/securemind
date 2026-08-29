export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";
import { getIdentity, identityErrorResponse } from "@/lib/identity";
import { resolveRuntimeSecrets } from "@/lib/instance-config";
import { selectGroqApiKey } from "@/lib/models/groq";

/** Audio larger than this is rejected before it reaches the provider. */
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

export async function POST(req: NextRequest) {
  try {
    await getIdentity(req);
  } catch (err) {
    const res = identityErrorResponse(err);
    if (res) return res;
    throw err;
  }

  const groqApiKey = selectGroqApiKey(await resolveRuntimeSecrets());
  if (!groqApiKey) {
    return NextResponse.json(
      { error: "No transcription provider configured." },
      { status: 503 },
    );
  }

  const formData = await req.formData();
  const audio = formData.get("audio");
  if (!audio || !(audio instanceof File)) {
    return NextResponse.json({ error: "audio field missing or invalid" }, { status: 400 });
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: "Audio file too large" }, { status: 413 });
  }

  try {
    const groq = new Groq({ apiKey: groqApiKey });
    const result = await groq.audio.transcriptions.create({
      file: audio,
      model: "whisper-large-v3-turbo",
      language: "en",
      response_format: "json",
      temperature: 0,
    });
    return NextResponse.json({ text: result.text ?? "" });
  } catch {
    // Provider errors can echo request content — never forward the raw message.
    console.error("[transcribe] provider request failed");
    return NextResponse.json({ error: "Transcription failed" }, { status: 500 });
  }
}
