/**
 * Voice and the monthly cost cap.
 *
 * Amazon Transcribe is billed per second of audio on the operator's AWS account, so voice counts
 * toward the same per-user monthly cap as chat. Every voice route checks the cap before audio is
 * sent, and Transcribe use is recorded as an inference event so Insights and the cap see it.
 *
 * Direct live captions run browser-to-AWS, so the server never learns how long a session lasted.
 * Each session is recorded at the longest an honest session can run (the browser ends it after
 * MAX_LIVE_SESSION_MINUTES), and each person may start LIVE_SESSIONS_PER_DAY of them a day. A
 * script that keeps a stream open longer is still limited by that daily count. The
 * whole-recording pass knows the exact length and records that.
 */

import { COST_CAP_EXCEEDED_CODE, COST_CAP_EXCEEDED_MESSAGE } from "@/lib/cost-cap-shared";
import { getUserCostCapStatus } from "@/lib/cost-cap";
import { recordInferenceEvent } from "@/lib/analytics/write";
import { db } from "@/lib/db";
import { usesHostedAppStore } from "@/lib/workspaces/store";
import { hostedAppStore } from "@/lib/workspaces/hosted-dynamo";
import { LIVE_SESSIONS_PER_DAY, MAX_LIVE_SESSION_MINUTES } from "./live-limits";

/** Amazon Transcribe Streaming list price, USD per minute (us-east-1, first pricing tier). */
export const TRANSCRIBE_USD_PER_MINUTE = 0.024;
/** What one direct live-captions session is recorded as: its full allowed length. */
export const LIVE_SESSION_ESTIMATE_MINUTES = MAX_LIVE_SESSION_MINUTES;
/** The usage label for live captions (direct sessions and the relayed route). */
export const LIVE_TRANSCRIBE_MODEL = "amazon-transcribe-live";
export { LIVE_SESSIONS_PER_DAY };

/** Start of the current UTC day. */
function utcDayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * Live-caption sessions this person started today (UTC), counted from the usage records, so the
 * limit holds across every server instance. If the records cannot be read the count is 0: voice
 * keeps working and the monthly cost cap still applies.
 */
export async function countLiveSessionsToday(userId: string, now = new Date()): Promise<number> {
  const from = utcDayStart(now);
  try {
    if (usesHostedAppStore()) {
      const events = await hostedAppStore().listInferenceEvents(userId, { fromIso: from.toISOString() });
      return events.filter(e => e.provider === "transcribe" && e.model === LIVE_TRANSCRIBE_MODEL).length;
    }
    return await db.inferenceEvent.count({
      where: { userId, provider: "transcribe", model: LIVE_TRANSCRIBE_MODEL, at: { gte: from } },
    });
  } catch (err) {
    console.warn("[voice] could not count live sessions:", err instanceof Error ? err.name : "error");
    return 0;
  }
}

/** A 402 response when the caller is over their monthly cap, or null to continue. */
export async function voiceCostCapResponse(userId: string): Promise<Response | null> {
  const cap = await getUserCostCapStatus(userId);
  if (!cap.capped) return null;
  return Response.json(
    {
      error: COST_CAP_EXCEEDED_MESSAGE,
      code: COST_CAP_EXCEEDED_CODE,
      spentUsd: cap.spentUsd,
      capUsd: cap.capUsd,
      resetsAt: cap.resetsAt,
    },
    { status: 402 },
  );
}

/** Record Amazon Transcribe use. Never throws: a failed write must not break voice. */
export async function recordTranscribeUsage(userId: string, minutes: number, model: string): Promise<void> {
  if (!(minutes > 0) || !Number.isFinite(minutes)) return;
  try {
    await recordInferenceEvent({
      userId,
      provider: "transcribe",
      model,
      tier: "Voice",
      status: "ok",
      extraCostUsd: minutes * TRANSCRIBE_USD_PER_MINUTE,
    });
  } catch (err) {
    console.warn("[voice] could not record usage:", err instanceof Error ? err.name : "error");
  }
}
