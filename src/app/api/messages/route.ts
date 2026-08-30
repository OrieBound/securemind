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

export const runtime = "nodejs";

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

  if (!sessionId || !role || !content?.trim()) {
    return Response.json({ error: "sessionId, role, and content are required" }, { status: 422 });
  }

  const message = await appendMessage(userId, sessionId, role, content.trim());
  if (!message) {
    return Response.json({ error: "Session not found" }, { status: 404 });
  }

  return Response.json({ id: message.id });
}
