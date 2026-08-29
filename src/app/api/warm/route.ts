/**
 * POST /api/warm
 *
 * Pre-wake the Node process (or a remote Lambda via NEXT_PUBLIC_API_BASE_URL)
 * before the user sends a chat message. Locally, also ask Ollama to keep the
 * installed chat model loaded so the first token is less likely to wait 10–30s.
 */

import { NextRequest } from "next/server";
import { getIdentity } from "@/lib/identity";
import { isHostedRuntime } from "@/lib/runtime-env";
import { preloadOllamaChatModel } from "@/lib/models/ollama";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    await getIdentity(req);
  } catch {
    return Response.json({ ok: true, warmedAt: Date.now() });
  }
  if (!isHostedRuntime()) {
    void preloadOllamaChatModel();
  }
  return Response.json({ ok: true, warmedAt: Date.now() });
}

export async function GET() {
  return Response.json({ ok: true, warmedAt: Date.now() });
}
