/**
 * Voice and the monthly cost cap.
 *
 * Amazon Transcribe is billed per second of audio on the operator's AWS account, so voice counts
 * toward the same per-user monthly cap as chat. Every voice route checks the cap before audio is
 * sent, and Transcribe use is recorded as an inference event so Insights and the cap see it.
 *
 * Direct live captions run browser-to-AWS, so the server never learns how long a session lasted.
 * Each session is recorded at a flat estimate when its address is signed, and the browser ends a
 * session after ten minutes. The whole-recording pass knows the exact length and records that.
 */

import { COST_CAP_EXCEEDED_CODE, COST_CAP_EXCEEDED_MESSAGE } from "@/lib/cost-cap-shared";
import { getUserCostCapStatus } from "@/lib/cost-cap";
import { recordInferenceEvent } from "@/lib/analytics/write";

/** Amazon Transcribe Streaming list price, USD per minute (us-east-1, first pricing tier). */
export const TRANSCRIBE_USD_PER_MINUTE = 0.024;
/** What one direct live-captions session is recorded as: one minute of audio. */
export const LIVE_SESSION_ESTIMATE_MINUTES = 1;

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
