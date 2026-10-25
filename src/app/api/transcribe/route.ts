export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getIdentity, identityErrorResponse } from "@/lib/identity";
import { instanceCanUseBedrock, resolveRuntimeSecrets } from "@/lib/instance-config";
import { selectGroqApiKey } from "@/lib/models/groq";
import { runtimeEdition } from "@/lib/runtime-env";
import { transcribeWithAmazon } from "@/lib/transcribe/amazon";
import { pickTranscribeBackend, transcribeUnavailableMessage } from "@/lib/transcribe/backend";
import { transcribeWithGroq } from "@/lib/transcribe/groq-whisper";
import { recordTranscribeUsage, voiceCostCapResponse } from "@/lib/transcribe/voice-usage";

/** Audio larger than this is rejected before it reaches the provider. */
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

export async function POST(req: NextRequest) {
  let userId: string;
  try {
    userId = (await getIdentity(req)).userId;
  } catch (err) {
    const res = identityErrorResponse(err);
    if (res) return res;
    throw err;
  }

  const secrets = await resolveRuntimeSecrets();
  const groqApiKey = selectGroqApiKey(secrets);
  const groqOk = Boolean(groqApiKey);
  const awsOk = await instanceCanUseBedrock();
  const backend = pickTranscribeBackend({
    edition: runtimeEdition(),
    groqOk,
    awsOk,
    choice: secrets.voiceSttChoice,
    audioAcked: secrets.voiceSttAudioAcked,
  });
  if (!backend) {
    return NextResponse.json(
      {
        error: transcribeUnavailableMessage({
          choice: secrets.voiceSttChoice,
          groqOk,
          awsOk,
          audioAcked: secrets.voiceSttAudioAcked,
        }),
      },
      { status: 503 },
    );
  }

  const overCap = await voiceCostCapResponse(userId);
  if (overCap) return overCap;

  const formData = await req.formData();
  const audio = formData.get("audio");
  if (!audio || !(audio instanceof File)) {
    return NextResponse.json({ error: "audio field missing or invalid" }, { status: 400 });
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: "Audio file too large" }, { status: 413 });
  }

  try {
    let text: string;
    if (backend === "groq") {
      text = await transcribeWithGroq(groqApiKey!, audio);
    } else {
      const wav = Buffer.from(await audio.arrayBuffer());
      text = await transcribeWithAmazon(wav);
      // 16 kHz mono 16-bit PCM is 32,000 bytes a second; the 44-byte header is negligible.
      await recordTranscribeUsage(userId, wav.length / 32_000 / 60, "amazon-transcribe");
    }
    return NextResponse.json({ text: text ?? "", provider: backend });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    console.error("[transcribe] provider request failed:", err instanceof Error ? `${err.name}: ${message.slice(0, 300)}` : "unknown error");
    const denied = /accessdenied|not authorized|unrecognizedclient/i.test(message);
    return NextResponse.json(
      {
        error:
          backend === "groq"
            ? "Groq Whisper could not transcribe that audio."
            : denied
              ? "Amazon Transcribe is not permitted for this role yet. Redeploy so the Amplify role includes transcribe:StartStreamTranscription."
              : "Amazon Transcribe could not transcribe that audio.",
        provider: backend,
      },
      { status: 500 },
    );
  }
}
