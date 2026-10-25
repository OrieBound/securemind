export const runtime = "nodejs";
export const maxDuration = 60;

import { NextRequest } from "next/server";
import { getIdentity, identityErrorResponse } from "@/lib/identity";
import { instanceCanUseBedrock, resolveRuntimeSecrets } from "@/lib/instance-config";
import { runtimeEdition } from "@/lib/runtime-env";
import { transcribePcmStream } from "@/lib/transcribe/amazon";
import { pickTranscribeBackend, transcribeUnavailableMessage } from "@/lib/transcribe/backend";
import { wavSampleRate } from "@/lib/transcribe/pcm-wav";
import { recordTranscribeUsage, voiceCostCapResponse } from "@/lib/transcribe/voice-usage";

/**
 * Cloud-only live STT: browser sends 16 kHz mono PCM; we emit NDJSON
 * `{ kind, text }` partials and finals. Local / on-prem does not use this route.
 */
export async function POST(req: NextRequest) {
  let userId: string;
  try {
    userId = (await getIdentity(req)).userId;
  } catch (err) {
    const res = identityErrorResponse(err);
    if (res) return res;
    throw err;
  }

  if (runtimeEdition() !== "cloud") {
    return Response.json(
      { error: "Live Amazon Transcribe is only used on the hosted install." },
      { status: 404 },
    );
  }
  const secrets = await resolveRuntimeSecrets();
  const awsOk = await instanceCanUseBedrock();
  const backend = pickTranscribeBackend({
    edition: "cloud",
    groqOk: false,
    awsOk,
    choice: secrets.voiceSttChoice,
    audioAcked: secrets.voiceSttAudioAcked,
  });
  if (backend !== "transcribe") {
    return Response.json(
      {
        error: transcribeUnavailableMessage({
          choice: secrets.voiceSttChoice,
          groqOk: false,
          awsOk,
          audioAcked: secrets.voiceSttAudioAcked,
        }),
      },
      { status: 503 },
    );
  }
  const overCap = await voiceCostCapResponse(userId);
  if (overCap) return overCap;

  if (!req.body) {
    return Response.json({ error: "audio stream missing" }, { status: 400 });
  }

  const body = req.body;
  let audioBytes = 0;
  async function* pcmChunks() {
    const reader = body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value && value.byteLength > 0) {
          audioBytes += value.byteLength;
          yield value;
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const ev of transcribePcmStream(pcmChunks(), wavSampleRate())) {
          controller.enqueue(encoder.encode(`${JSON.stringify(ev)}\n`));
        }
        // 16-bit mono PCM: two bytes per sample.
        await recordTranscribeUsage(userId, audioBytes / (wavSampleRate() * 2) / 60, "amazon-transcribe-live");
        controller.close();
      } catch (err) {
        // Name and message only, never the audio. The message is the provider's or SDK's own error text.
        console.error("[transcribe/live] stream failed:", err instanceof Error ? `${err.name}: ${err.message.slice(0, 300)}` : "unknown error");
        try {
          controller.enqueue(
            encoder.encode(`${JSON.stringify({ kind: "error", text: "Transcription failed" })}\n`),
          );
        } catch {
          /* already closed */
        }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
