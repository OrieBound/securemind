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
import { getIdentity } from "@/lib/identity";
import { appendMessage } from "@/lib/workspaces/store";
import { scrubServerText } from "@/lib/chat/server-scrub";

export const runtime = "nodejs";

/** Long enough for any real reply (including a generated file block), short enough to bound storage. */
const MAX_MESSAGE_CHARS = 200_000;

type MessageRequest = {
  sessionId: string;
  role: "user" | "assistant";
  content: string;
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

  if (!sessionId || typeof content !== "string" || !content.trim()) {
    return Response.json({ error: "sessionId, role, and content are required" }, { status: 422 });
  }
  if (role !== "user" && role !== "assistant") {
    return Response.json({ error: "role must be user or assistant" }, { status: 422 });
  }
  if (content.length > MAX_MESSAGE_CHARS) {
    return Response.json({ error: "Message is too long to save" }, { status: 413 });
  }

  const message = await appendMessage(userId, sessionId, role, scrubServerText(content.trim()));
  if (!message) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }

  return Response.json({ id: message.id });
}
