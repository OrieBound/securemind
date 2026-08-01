/**
 * GET    /api/agents/:id  — get a single agent with its facts
 * PATCH  /api/agents/:id  — update agent profile
 * DELETE /api/agents/:id  — delete agent and all its data
 *
 * Every handler resolves the agent through `findFirst({ id, userId })` rather
 * than `findUnique({ id })`. An id alone must never be sufficient to read or
 * mutate a record. A miss returns 404 rather than 403 so the endpoint does not
 * confirm that an id exists for some other owner.
 */

import { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getIdentity } from "@/lib/identity";
import { compilePersonalityPrompt, compileTagline, parsePersonalityConfig } from "@/lib/agents/personality-compiler";
import { jsonForPrisma } from "@/lib/json-for-prisma";

export const runtime = "nodejs";

const NOT_FOUND = () => Response.json({ error: "Agent not found" }, { status: 404 });

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { userId } = await getIdentity(req);

  const agent = await db.agent.findFirst({
    where:   { id, userId },
    include: { facts: true },
  });

  if (!agent) return NOT_FOUND();
  return Response.json(agent);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { userId } = await getIdentity(req);

  const body = await req.json() as {
    name?: string;
    emoji?: string;
    color?: string;
    personality?: string;
    personalityConfig?: unknown;
    tagline?: string;
    preferredMode?: string;
    modelOverride?: string | null;
  };

  const existing = await db.agent.findFirst({ where: { id, userId } });
  if (!existing) return NOT_FOUND();

  const data: Prisma.AgentUpdateInput = {
    ...(body.name          !== undefined && { name:          body.name }),
    ...(body.emoji         !== undefined && { emoji:         body.emoji }),
    ...(body.color         !== undefined && { color:         body.color }),
    ...(body.preferredMode !== undefined && { preferredMode: body.preferredMode }),
    ...(body.modelOverride !== undefined && { modelOverride: body.modelOverride }),
  };

  try {
    if (body.personalityConfig !== undefined) {
      const config = parsePersonalityConfig(body.personalityConfig, existing.personality);
      const agentName = body.name ?? existing.name;
      data.personalityConfig = jsonForPrisma(config) as Prisma.InputJsonValue;
      data.personality = compilePersonalityPrompt(config, agentName);
      data.tagline = body.tagline ?? compileTagline(config);
    } else {
      if (body.personality !== undefined) data.personality = body.personality;
      if (body.tagline !== undefined) data.tagline = body.tagline;
    }

    const agent = await db.agent.update({ where: { id }, data });
    return Response.json(agent);
  } catch (err) {
    console.error("[agents PATCH]", err);
    const message = err instanceof Error ? err.message : "Update failed";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { userId } = await getIdentity(req);

  const agent = await db.agent.findFirst({ where: { id, userId }, select: { id: true } });
  if (!agent) return NOT_FOUND();

  const count = await db.agent.count({ where: { userId } });
  if (count <= 1) {
    return Response.json({ error: "Cannot delete your only agent" }, { status: 400 });
  }

  await db.agent.delete({ where: { id } });
  return Response.json({ deleted: true });
}
