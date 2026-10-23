/**
 * POST /api/summarize
 *
 * Background memory compression — triggered by the client after every N turns,
 * or fact capture (`purpose: "facts"`) after each user message without advancing
 * the compression cursor.
 * Uses a cheap fast model (llama3.2:3b) so it never blocks the main chat.
 *
 * Body:   { messages, existingSummary?, existingFacts?, purpose? }
 * Returns { summary, facts }
 */

import { NextRequest } from "next/server";
import { probeOllama, streamOllamaChat } from "@/lib/models/ollama";
import { streamGroqChat } from "@/lib/models/groq";
import { pickInstalledChatModel } from "@/lib/models/local-recommendations";
import { routeModel } from "@/lib/models/router";
import { streamChat } from "@/lib/models/provider";
import { getModelCatalogCached } from "@/lib/models/catalog";
import { pickBackgroundVendorModel, type BackgroundVendorModel } from "@/lib/models/background-model";
import { getVendorConsentFlags } from "@/lib/instance-config";
import { db } from "@/lib/db";
import { getIdentity } from "@/lib/identity";
import { usesHostedAppStore } from "@/lib/workspaces/store";
import { hostedAppStore } from "@/lib/workspaces/hosted-dynamo";

export const runtime = "nodejs";

/** How long the local model gets before the vendor fallback is tried. */
const LOCAL_BACKGROUND_TIMEOUT_MS = 60_000;

async function pickVendorFallback(): Promise<BackgroundVendorModel | null> {
  try {
    const flags = await getVendorConsentFlags();
    if (!flags.externalRiskAckAt) return null;
    const catalog = await getModelCatalogCached();
    return pickBackgroundVendorModel(
      [catalog.anthropic, catalog.openai, catalog.google, catalog.xai].flatMap(bucket => bucket ?? []),
    );
  } catch {
    return null;
  }
}

type HistoryMessage = { role: "user" | "assistant"; content: string };

type SummarizeRequest = {
  messages: HistoryMessage[];
  existingSummary?: string;
  existingFacts?: Record<string, unknown>;
  sessionId?: string;
  workspaceId?: string;
  turnsCovered?: number;
  /** facts = capture user-stated facts without compressing the thread. */
  purpose?: "facts" | "compress";
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

const SYSTEM_PROMPT = `You are a memory compression engine for SecureMind.
Extract only durable USER-authored information. Provenance must stay honest.

Given a conversation excerpt (and optionally an existing summary + facts), produce:
1. A concise updated summary (3–5 sentences max) of what the USER discussed that is worth remembering.
2. A facts object of USER identity / preference facts only when clearly stated by the user.

   Allowed keys: name, occupation, location, projects, goals, preferred_response_length
   (short/medium/detailed), technical_level (beginner/intermediate/expert)

Rules:
- ONLY extract facts from User: lines. Never store Assistant: content as a user fact.
- Never store general world knowledge the assistant explained (e.g. what lava is).
- Never store guesses, inferences, retrieved document content, or unconfirmed summaries.
- Never invent personality, friendship, emotional, or companion-profiling facts.
- If the user corrects a prior misunderstanding, drop the incorrect fact; do not keep it.
- If nothing durable was stated by the user, return {"summary":"…","facts":{}} with facts empty or unchanged.
- Write the summary in third-person about the user ("The user mentioned…").
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
    workspaceId,
    turnsCovered    = 0,
    purpose         = "compress",
  } = body;

  const factsOnly = purpose === "facts";

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
    const collect = async (stream: AsyncGenerator<string>) => {
      fullResponse = "";
      for await (const chunk of stream) fullResponse += chunk;
    };

    let primaryError: unknown = null;
    try {
      await collect(
        provider === "groq" ? streamGroqChat(msgs, model) : streamOllamaChat(msgs, model),
      );
    } catch (err) {
      primaryError = err;
    }

    if (primaryError && provider === "groq") {
      // The documented fast Groq id is not on every key, and Groq may be blocked. Local chat comes
      // next because the text stays on this machine; it gets a time limit so a slow CPU cannot
      // hold the request for minutes.
      try {
        const probe = await probeOllama(2500);
        const local = pickInstalledChatModel(probe.tags);
        if (local) {
          console.error("[summarize] Groq fast model failed; using local", local);
          await collect(streamOllamaChat(msgs, local, AbortSignal.timeout(LOCAL_BACKGROUND_TIMEOUT_MS)));
          primaryError = null;
        }
      } catch (err) {
        console.error("[summarize] local model failed:", err instanceof Error ? err.message : err);
      }
    }

    if (primaryError) {
      // Last resort: a small vendor model that already answered a test here, and only when the
      // operator has accepted that detected text is replaced before vendor calls.
      const vendor = await pickVendorFallback();
      if (!vendor) throw primaryError;
      console.error("[summarize] using vendor model", vendor.model);
      await collect(
        streamChat({ messages: msgs, model: vendor.model, provider: vendor.provider, lockProvider: true }),
      );
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
      if (usesHostedAppStore() && workspaceId) {
        const store = hostedAppStore();
        const ts = new Date().toISOString();
        const existingSummary = await store.getSessionSummary(userId, workspaceId, sessionId);
        void store.putSessionSummary({
          id: existingSummary?.id ?? crypto.randomUUID(),
          userId,
          workspaceId,
          sessionId,
          summary: newSummary,
          turnsCovered: factsOnly ? (existingSummary?.turnsCovered ?? 0) : turnsCovered,
          updatedAt: ts,
        }).catch(err => console.error("[summarize] hosted summary persist failed:", err));

        void (async () => {
          for (const [key, value] of Object.entries(newFacts)) {
            const serialized = serializeFactValue(value);
            if (!serialized) continue;
            const existing = (await store.listFacts(userId, workspaceId)).find(f => f.key === key);
            if (existing?.pinned || existing?.forgotten) continue;
            await store.putFact({
              id: existing?.id ?? crypto.randomUUID(),
              userId,
              workspaceId,
              key,
              value: serialized,
              confidence: existing?.confidence ?? 0.8,
              source: sessionId,
              pinned: false,
              forgotten: false,
              correctedAt: existing?.correctedAt ?? null,
              correctedByUserId: existing?.correctedByUserId ?? null,
              createdAt: existing?.createdAt ?? ts,
              updatedAt: ts,
            });
          }
        })().catch(err => console.error("[summarize] hosted fact persist failed:", err));
      } else if (!usesHostedAppStore()) {
      // sessionId and workspaceId come from the request body. Only write when the session
      // belongs to this user (and to that workspace), so one account cannot overwrite another's
      // summary or facts by guessing ids.
      const ownedSession = await db.session.findFirst({
        where: { id: sessionId, userId, ...(workspaceId ? { workspaceId } : {}) },
        select: { id: true },
      });
      if (ownedSession) Promise.all([
        // Upsert the session summary
        db.sessionSummary.upsert({
          where:  { sessionId },
          update: factsOnly
            ? { summary: newSummary }
            : { summary: newSummary, turnsCovered },
          create: { sessionId, summary: newSummary, turnsCovered: factsOnly ? 0 : turnsCovered },
        }),
        // Upsert facts — always per-workspace for full isolation
        ...(workspaceId
          ? Object.entries(newFacts).map(async ([key, value]) => {
              const serialized = serializeFactValue(value);
              if (!serialized) return null;
              const existing = await db.workspaceFact.findUnique({
                where: { workspaceId_key: { workspaceId, key } },
                select: { pinned: true, forgotten: true },
              });
              if (existing?.pinned || existing?.forgotten) return null;
              return db.workspaceFact.upsert({
                where:  { workspaceId_key: { workspaceId, key } },
                update: { value: serialized, source: sessionId },
                create: { workspaceId, userId, key, value: serialized, source: sessionId },
              });
            }).filter(Boolean)
          : [] // No workspaceId = no fact persistence (should never happen in practice)
        ),
      ]).catch(err => console.error("[summarize] DB persist failed:", err));
      }
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
