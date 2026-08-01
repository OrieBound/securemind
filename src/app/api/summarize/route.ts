/**
 * POST /api/summarize
 *
 * Background memory compression — triggered by the client after every N turns.
 * Uses a cheap fast model (llama3.2:3b) so it never blocks the main chat.
 *
 * Body:   { messages, existingSummary?, existingFacts? }
 * Returns { summary, facts }
 */

import { NextRequest } from "next/server";
import { streamOllamaChat } from "@/lib/models/ollama";
import { streamGroqChat } from "@/lib/models/groq";
import { routeModel } from "@/lib/models/router";
import { db } from "@/lib/db";
import { getIdentity } from "@/lib/identity";

export const runtime = "nodejs";

type HistoryMessage = { role: "user" | "assistant"; content: string };

type SummarizeRequest = {
  messages: HistoryMessage[];
  existingSummary?: string;
  existingFacts?: Record<string, unknown>;
  sessionId?: string;
  agentId?: string;
  turnsCovered?: number;
};

/** Serialize fact values for DB storage — never persist [object Object]. */
function serializeFactValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

const SYSTEM_PROMPT = `You are a memory compression engine for a personal AI assistant.
Your job: extract and preserve two categories of information from a conversation.

Given a conversation excerpt (and optionally an existing summary + facts), produce:
1. A concise updated summary (3–5 sentences max) of what was discussed.
2. A facts object combining TWO types of facts:

   IDENTITY FACTS — who the user is:
   Keys: name, age, occupation, location, projects, goals, interests, skills

   BEHAVIORAL FACTS — how the user communicates and what they prefer:
   Keys: response_length (short/medium/detailed), technical_level (beginner/intermediate/expert),
         communication_style (direct/conversational/formal), preferred_topics (comma-separated),
         tone_preference (casual/professional/warm), feedback_style (blunt/gentle/structured)

   PERSONALITY FACTS — temperament and social style (infer from how they write and what they discuss):
   Keys: sociability (low/moderate/high), talkativeness (low/moderate/high),
         patience (low/moderate/high), calmness (low/moderate/high),
         sensitivity (low/moderate/high), politeness (low/moderate/high),
         preferred_problem_types (comma-separated, e.g. "engineering, personal reflection, planning"),
         emotional_tone (comma-separated tags, e.g. "curious, focused, casual")

Rules:
- Only include facts explicitly stated or clearly implied — never invent.
- Behavioral facts should be inferred from HOW the user writes, not just what they say.
  e.g. short clipped messages → response_length: short, technical jargon → technical_level: expert
- If a fact conflicts with existing facts, use the newer value.
- Write the summary in third-person ("The user mentioned…").
- Return ONLY valid JSON — no markdown, no explanation.

Format:
{"summary":"…","facts":{"key":"value"}}`;

export async function POST(req: NextRequest) {
  const { userId } = await getIdentity(req);

  let body: SummarizeRequest;
  try {
    body = (await req.json()) as SummarizeRequest;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const {
    messages,
    existingSummary = "",
    existingFacts   = {},
    sessionId,
    agentId,
    turnsCovered    = 0,
  } = body;

  if (!messages?.length) {
    return Response.json({ summary: existingSummary, facts: existingFacts });
  }

  const { model, provider } = routeModel("summarize");

  const transcript = messages
    .map(m => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n");

  const parts: string[] = [];
  if (existingSummary) parts.push(`Existing summary:\n${existingSummary}`);
  if (Object.keys(existingFacts).length)
    parts.push(`Existing facts:\n${JSON.stringify(existingFacts, null, 2)}`);
  parts.push(`New conversation to incorporate:\n${transcript}`);

  const userContent = parts.join("\n\n");
  const msgs = [
    { role: "system" as const, content: SYSTEM_PROMPT },
    { role: "user"   as const, content: userContent },
  ];

  let fullResponse = "";
  try {
    const stream = provider === "groq"
      ? streamGroqChat(msgs, model)
      : streamOllamaChat(msgs, model);

    for await (const chunk of stream) {
      fullResponse += chunk;
    }

    const jsonMatch = fullResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found in model response");

    const result = JSON.parse(jsonMatch[0]) as {
      summary?: string;
      facts?: Record<string, string>;
    };

    const newSummary = result.summary ?? existingSummary;
    const newFacts   = { ...existingFacts, ...(result.facts ?? {}) };

    // Persist to database (fire-and-forget style — don't block the response)
    if (sessionId) {
      Promise.all([
        // Upsert the session summary
        db.sessionSummary.upsert({
          where:  { sessionId },
          update: { summary: newSummary, turnsCovered },
          create: { sessionId, summary: newSummary, turnsCovered },
        }),
        // Upsert facts — always per-agent for full companion isolation
        ...(agentId
          ? Object.entries(newFacts).map(([key, value]) => {
              const serialized = serializeFactValue(value);
              if (!serialized) return null;
              return db.agentFact.upsert({
                where:  { agentId_key: { agentId, key } },
                update: { value: serialized, source: sessionId },
                create: { agentId, userId, key, value: serialized, source: sessionId },
              });
            }).filter(Boolean)
          : [] // No agentId = no fact persistence (should never happen in practice)
        ),
      ]).catch(err => console.error("[summarize] DB persist failed:", err));
    }

    return Response.json({
      summary: newSummary,
      facts: Object.fromEntries(
        Object.entries(newFacts).map(([k, v]) => [k, serializeFactValue(v)]),
      ),
    });
  } catch (err) {
    // Never break the app — silently fall back to existing memory
    console.error("[summarize] failed:", err);
    return Response.json({ summary: existingSummary, facts: existingFacts });
  }
}
