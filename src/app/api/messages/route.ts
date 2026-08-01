/**
 * POST /api/messages
 *
 * Saves a single message (user or assistant) to the session in the database.
 * Called client-side after each turn — user message before the stream starts,
 * assistant message after the stream completes.
 *
 * Body: { sessionId, role, content }
 */

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getIdentity } from "@/lib/identity";
import { storeMemoryFragment } from "@/lib/memory";

export const runtime = "nodejs";

// Minimum content length to bother embedding (very short messages aren't useful as memories)
const MIN_EMBED_CHARS = 60;

type MessageRequest = {
  sessionId: string;
  role:      "user" | "assistant";
  content:   string;
};

export async function POST(req: NextRequest) {
  const { userId } = await getIdentity(req);

  let body: MessageRequest;
  try {
    body = (await req.json()) as MessageRequest;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { sessionId, role, content } = body;

  if (!sessionId || !role || !content?.trim()) {
    return Response.json({ error: "sessionId, role, and content are required" }, { status: 422 });
  }

  const trimmed = content.trim();

  // Resolve the session under the caller's identity before writing. Accepting a
  // bare sessionId would let any caller append messages to another user's thread.
  const session = await db.session.findFirst({
    where:  { id: sessionId, userId },
    select: { agentId: true, userId: true },
  });
  if (!session) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }

  const message = await db.message.create({
    data: { sessionId, role, content: trimmed },
  });

  // Touch the session so updatedAt stays current (used for ordering)
  await db.session.update({
    where: { id: sessionId },
    data:  { updatedAt: new Date() },
  });

  // Embed assistant messages as episodic memory fragments (fire-and-forget).
  // Only assistant messages are embedded — they contain the richest context
  // and are what we want to surface when semantically searching past exchanges.
  if (role === "assistant" && trimmed.length >= MIN_EMBED_CHARS && session?.agentId) {
    storeMemoryFragment({
      content:   trimmed,
      agentId:   session.agentId,
      sessionId,
      userId:    session.userId,
      category:  "episodic",
    }).catch(err => console.warn("[messages] embed failed (non-critical):", String(err)));
  }

  return Response.json({ id: message.id });
}
