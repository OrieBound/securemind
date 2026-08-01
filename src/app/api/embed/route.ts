/**
 * POST /api/embed
 *
 * Embeds a piece of text and stores it as a MemoryFragment.
 * Called as a fire-and-forget background task from the messages route
 * after each assistant turn, and from the backfill script for existing messages.
 *
 * Body: { content, agentId?, sessionId?, category? }
 */

import { NextRequest } from "next/server";
import { storeMemoryFragment } from "@/lib/memory";
import { getIdentity } from "@/lib/identity";

export const runtime = "nodejs";

type EmbedRequest = {
  content:    string;
  agentId?:   string;
  sessionId?: string;
  category?:  string;
};

export async function POST(req: NextRequest) {
  const { userId } = await getIdentity(req);

  let body: EmbedRequest;
  try {
    body = (await req.json()) as EmbedRequest;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { content, agentId, sessionId, category = "episodic" } = body;

  if (!content?.trim()) {
    return Response.json({ error: "content is required" }, { status: 422 });
  }

  try {
    const id = await storeMemoryFragment({ content, agentId, sessionId, userId, category });
    return Response.json({ id });
  } catch (err) {
    console.error("[embed]", err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
