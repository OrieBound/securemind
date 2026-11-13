export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getIdentity, identityErrorResponse } from "@/lib/identity";
import { instanceCanUseBedrock, resolveRuntimeSecrets } from "@/lib/instance-config";
import { hitRateLimit } from "@/lib/rate-limit";
import { runtimeEdition } from "@/lib/runtime-env";
import { pickTranscribeBackend, transcribeUnavailableMessage } from "@/lib/transcribe/backend";
import { createTranscribeStreamUrl, transcribeStreamConfig } from "@/lib/transcribe/stream-session";
import {
  countLiveSessionsToday,
  LIVE_SESSION_ESTIMATE_MINUTES,
  LIVE_SESSIONS_PER_DAY,
  LIVE_TRANSCRIBE_MODEL,
  recordTranscribeUsage,
  voiceCostCapResponse,
} from "@/lib/transcribe/voice-usage";

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

  const overCap = await voiceCostCapResponse(userId);
  if (overCap) return overCap;

  // A daily count that holds across server instances. The browser treats a refusal like any failed
  // live session and transcribes the whole recording after Done, billed by the exact second.
  if ((await countLiveSessionsToday(userId)) >= LIVE_SESSIONS_PER_DAY) {
    return Response.json(
      {
        error: `Live captions are limited to ${LIVE_SESSIONS_PER_DAY} sessions a day. Voice still works: your words appear after you tap Done.`,
        code: "LIVE_SESSION_DAILY_LIMIT",
      },
      { status: 429 },
    );
  }

  try {
    const session = await createTranscribeStreamUrl(config, userId);
    await recordTranscribeUsage(userId, LIVE_SESSION_ESTIMATE_MINUTES, LIVE_TRANSCRIBE_MODEL);
    return Response.json(session, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[transcribe/live-session] could not sign:", err instanceof Error ? `${err.name}: ${err.message.slice(0, 300)}` : "unknown error");
    return Response.json({ error: "Could not start live captions." }, { status: 502 });
  }
}
