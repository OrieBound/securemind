export const runtime = "nodejs";

/**
 * POST /api/models/ollama/pull
 *
 * Operator-initiated pull of an allowlisted local model. Never called from
 * first-run automatically.
 */

import { NextRequest } from "next/server";
import { getIdentity, identityErrorResponse } from "@/lib/identity";
import { requireAdmin } from "@/lib/roles";
import { isHostedRuntime } from "@/lib/runtime-env";
import { isAllowedOllamaPull } from "@/lib/models/local-recommendations";
import { ollamaBaseUrl } from "@/lib/models/ollama";

export async function POST(req: NextRequest) {
  try {
    const identity = await getIdentity(req);
    requireAdmin(identity);
  } catch (err) {
    const res = identityErrorResponse(err);
    if (res) return res;
    throw err;
  }

  if (isHostedRuntime()) {
    return Response.json(
      { error: "Ollama is not available in a hosted deployment. Use Amazon Bedrock or a bring-your-own provider." },
      { status: 400 },
    );
  }

  let body: { model?: unknown };
  try {
    body = (await req.json()) as { model?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const model = typeof body.model === "string" ? body.model.trim() : "";
  if (!model || !isAllowedOllamaPull(model)) {
    return Response.json(
      { error: "That model is not on the guided pull list. Pull it with the Ollama CLI if you need it." },
      { status: 422 },
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${ollamaBaseUrl()}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: model, stream: true }),
    });
  } catch {
    return Response.json(
      { error: "Cannot reach Ollama. Install it from https://ollama.com/download and start the app." },
      { status: 503 },
    );
  }

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    return Response.json(
      { error: text || `Ollama pull failed (${upstream.status})` },
      { status: 502 },
    );
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-store",
    },
  });
}
