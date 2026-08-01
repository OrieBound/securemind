/**
 * GET  /api/workspaces — list the caller's workspaces
 * POST /api/workspaces — create a workspace
 *
 * A workspace is a bounded operational context. It owns its own documents,
 * conversations, and extracted facts, and none of those cross between them.
 */

import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getIdentity } from "@/lib/identity";

export const runtime = "nodejs";

/** Trim to a sane length so a client cannot push unbounded text into a prompt. */
const MAX_NAME = 60;
const MAX_DESCRIPTION = 140;
const MAX_CONTEXT = 2000;

function clean(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

export async function GET(req: NextRequest) {
  const { userId } = await getIdentity(req);

  const workspaces = await db.workspace.findMany({
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

  // First run: give the caller somewhere to work rather than an empty screen.
  if (workspaces.length === 0) {
    const initial = await db.workspace.create({
      data: {
        userId,
        name:        "Cloud Operations",
        emoji:       "☁️",
        color:       "#6366f1",
        description: "Runbooks, incidents, architecture, and operational knowledge.",
        isDefault:   true,
      },
      include: {
        sessions: { include: { messages: true } },
      },
    });
    return Response.json([initial]);
  }

  return Response.json(workspaces);
}

export async function POST(req: NextRequest) {
  const { userId } = await getIdentity(req);
  const body = await req.json() as {
    name?: unknown;
    emoji?: unknown;
    color?: unknown;
    description?: unknown;
    context?: unknown;
  };

  const name = clean(body.name, MAX_NAME);
  if (!name) {
    return Response.json({ error: "A workspace name is required" }, { status: 400 });
  }

  const workspace = await db.workspace.create({
    data: {
      userId,
      name,
      emoji:       clean(body.emoji, 8)                 ?? "🗂️",
      color:       clean(body.color, 32)                ?? "#6366f1",
      description: clean(body.description, MAX_DESCRIPTION) ?? null,
      context:     clean(body.context, MAX_CONTEXT)     ?? null,
      isDefault:   false,
    },
  });

  return Response.json(workspace, { status: 201 });
}
