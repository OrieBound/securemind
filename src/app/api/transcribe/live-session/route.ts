export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getIdentity, identityErrorResponse } from "@/lib/identity";
import { instanceCanUseBedrock, resolveRuntimeSecrets } from "@/lib/instance-config";
import { hitRateLimit } from "@/lib/rate-limit";
import { runtimeEdition } from "@/lib/runtime-env";
import { pickTranscribeBackend, transcribeUnavailableMessage } from "@/lib/transcribe/backend";
import { createTranscribeStreamUrl, transcribeStreamConfig } from "@/lib/transcribe/stream-session";

/**
 * Hosted only. Returns a short-lived signed WebSocket address so the browser can stream the
 * microphone straight to Amazon Transcribe and show words as they are spoken. The address is the
 * only secret in the response, it is good for five minutes, and it can only open a Transcribe
 * connection (see stream-session.ts). Never log or store it.
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
    return Response.json({ error: "Direct live captions are only used on the hosted install." }, { status: 404 });
  }
  const config = transcribeStreamConfig();
  if (!config) {
    return Response.json({ error: "Direct live captions are not set up on this install." }, { status: 404 });
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

  // One address per mic start. Per server process, like the other limits: it stops a script, not a person.
  const wait = hitRateLimit("transcribe-session", userId, 20, 60_000);
  if (wait > 0) {
    return Response.json(
      { error: "Too many voice sessions. Wait a moment and try again." },
      { status: 429, headers: { "Retry-After": String(wait) } },
    );
  }

  try {
    const session = await createTranscribeStreamUrl(config, userId);
    return Response.json(session, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[transcribe/live-session] could not sign:", err instanceof Error ? `${err.name}: ${err.message.slice(0, 300)}` : "unknown error");
    return Response.json({ error: "Could not start live captions." }, { status: 502 });
  }
}
