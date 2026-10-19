/**
 * POST /api/chat
 *
 * Streams assistant replies over SSE. Core logic lives in
 * `src/lib/chat/run-chat-stream.ts` so the API Gateway Lambda can share it.
 */

import { NextRequest } from "next/server";
import { getIdentity, IdentityError } from "@/lib/identity";
import {
  prepareChatTurn,
  chatSseReadableStream,
} from "@/lib/chat/run-chat-stream";
import type { ChatRequestBody } from "@/lib/chat/types";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let userId: string;
  try {
    ({ userId } = await getIdentity(req));
  } catch (err) {
    if (err instanceof IdentityError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

  let body: ChatRequestBody;
  try {
    body = (await req.json()) as ChatRequestBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const prepared = await prepareChatTurn(userId, body);
  if (!prepared.ok) {
    return Response.json(prepared.body, { status: prepared.status });
  }

  return new Response(chatSseReadableStream(prepared.ctx), {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
