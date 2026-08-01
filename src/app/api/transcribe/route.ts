export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";

export async function POST(req: NextRequest) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GROQ_API_KEY not configured" }, { status: 500 });
  }

  const formData = await req.formData();
  const audio = formData.get("audio");
  if (!audio || !(audio instanceof File)) {
    return NextResponse.json({ error: "audio field missing or invalid" }, { status: 400 });
  }

  try {
    const groq = new Groq({ apiKey });
    const result = await groq.audio.transcriptions.create({
      file: audio,
      model: "whisper-large-v3-turbo",
      language: "en",
      response_format: "json",
      temperature: 0,
    });
    return NextResponse.json({ text: result.text ?? "" });
  } catch (err) {
    console.error("[transcribe]", err);
    return NextResponse.json({ error: "Transcription failed" }, { status: 500 });
  }
}
