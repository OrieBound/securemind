/**
 * POST /api/agents/generate-profile
 * Generate PersonalityConfig from a natural-language description (cheap model).
 */

import { NextRequest } from "next/server";
import { streamGroqChat } from "@/lib/models/groq";
import { streamOllamaChat } from "@/lib/models/ollama";
import { routeModel } from "@/lib/models/router";
import { parsePersonalityConfig } from "@/lib/agents/personality-compiler";
import { ARCHETYPE_DEFINITIONS, TRAIT_DEFINITIONS } from "@/lib/agents/personality-types";

export const runtime = "nodejs";

const ARCH_IDS = ARCHETYPE_DEFINITIONS.map(a => a.id).join(", ");
const TRAIT_IDS = TRAIT_DEFINITIONS.map(t => t.id).join(", ");

const SYSTEM_PROMPT = `You design AI companion personalities. Given a user's description, output ONLY valid JSON matching this schema:

{
  "archetypes": [{ "id": "<one of: ${ARCH_IDS}>", "weight": 0-100 }],
  "traits": { "<trait_id>": 0-100 for each of: ${TRAIT_IDS} },
  "voice": { "tone": ["string tags"], "humor": 0-100, "verbosity": 0-100, "emojiLevel": 0-100 },
  "boundaries": { "pushback": 0-100, "sycophancy": 0-100 },
  "freeform": "one optional sentence capturing unique flavor"
}

Rules:
- Use 1-3 archetypes; weights should sum to ~100.
- Infer traits from the description — do not default everything to 50.
- flirtiness should stay low (0-15) unless explicitly requested.
- sycophancy should usually be low (10-35) for direct companions.
- No markdown, no explanation — JSON only.`;

export async function POST(req: NextRequest) {
  let description: string;
  try {
    const body = await req.json() as { description?: string };
    description = body.description?.trim() ?? "";
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!description) {
    return Response.json({ error: "Description is required" }, { status: 400 });
  }

  const { model, provider } = routeModel("summarize");
  const msgs = [
    { role: "system" as const, content: SYSTEM_PROMPT },
    { role: "user" as const, content: `Design a companion personality for: ${description}` },
  ];

  let fullResponse = "";
  try {
    const stream = provider === "groq"
      ? streamGroqChat(msgs, model)
      : streamOllamaChat(msgs, model);

    for await (const chunk of stream) fullResponse += chunk;

    const jsonMatch = fullResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON in response");

    const raw = JSON.parse(jsonMatch[0]) as unknown;
    const config = parsePersonalityConfig(raw, description);
    return Response.json({ config });
  } catch (err) {
    console.error("[generate-profile] failed:", err);
    return Response.json({ error: "Could not generate profile" }, { status: 500 });
  }
}
