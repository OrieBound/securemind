/**
 * GET  /api/agents        — list all agents for a user
 * POST /api/agents        — create a new agent
 */

import { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getIdentity } from "@/lib/identity";
import { compilePersonalityPrompt, compileTagline, parsePersonalityConfig } from "@/lib/agents/personality-compiler";
import { defaultPersonalityConfig } from "@/lib/agents/personality-types";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { userId } = await getIdentity(req);

  const agents = await db.agent.findMany({
    where:   { userId },
    orderBy: { createdAt: "asc" },
    include: {
      sessions: {
        orderBy: { updatedAt: "desc" },
        take: 1,
        include: {
          messages: { orderBy: { createdAt: "desc" }, take: 1 },
        },
      },
    },
  });

  // If no agents exist yet, create the default Sage agent
  if (agents.length === 0) {
    const config = defaultPersonalityConfig();
    const sage = await db.agent.create({
      data: {
        userId,
        name:              "Sage",
        emoji:             "🧠",
        color:             "#6366f1",
        personality:       compilePersonalityPrompt(config, "Sage"),
        personalityConfig: config as Prisma.InputJsonValue,
        tagline:           compileTagline(config),
        preferredMode:     "Companion",
        isDefault:         true,
      },
      include: {
        sessions: { include: { messages: true } },
      },
    });
    return Response.json([sage]);
  }

  return Response.json(agents);
}

export async function POST(req: NextRequest) {
  const { userId } = await getIdentity(req);
  const body = await req.json() as {
    name: string;
    emoji?: string;
    color?: string;
    personality?: string;
    personalityConfig?: unknown;
    tagline?: string;
    preferredMode?: string;
  };

  const config = body.personalityConfig
    ? parsePersonalityConfig(body.personalityConfig, body.personality)
    : defaultPersonalityConfig();
  const name = body.name;

  const agent = await db.agent.create({
    data: {
      userId,
      name,
      emoji:             body.emoji         ?? "🤖",
      color:             body.color         ?? "#6366f1",
      personality:       body.personality   ?? compilePersonalityPrompt(config, name),
      personalityConfig: config as Prisma.InputJsonValue,
      tagline:           body.tagline       ?? compileTagline(config),
      preferredMode:     body.preferredMode ?? "Companion",
      isDefault:         false,
    },
  });

  return Response.json(agent, { status: 201 });
}
