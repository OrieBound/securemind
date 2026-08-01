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

const DEFAULT_WORKSPACE_NAME = "Aegis";
const DEFAULT_WORKSPACE_EMOJI = "🛡️";
const DEFAULT_WORKSPACE_DESCRIPTION =
  "Runbooks, incidents, architecture, and operational knowledge.";

/** Prior default name — renamed once so local DBs pick up the new identity. */
const LEGACY_DEFAULT_NAME = "Cloud Operations";

function clean(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

export async function GET(req: NextRequest) {
  const { userId } = await getIdentity(req);

  let workspaces = await db.workspace.findMany({
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
        name:        DEFAULT_WORKSPACE_NAME,
        emoji:       DEFAULT_WORKSPACE_EMOJI,
        color:       "#6366f1",
        description: DEFAULT_WORKSPACE_DESCRIPTION,
        isDefault:   true,
      },
      include: {
        sessions: { include: { messages: true } },
      },
    });
    return Response.json([initial]);
  }

  // One-time rename of the previous default seed name so the chat speaker
  // identity matches the new default without a manual Workspace edit.
  const legacyDefault = workspaces.find(
    w => w.isDefault && w.name === LEGACY_DEFAULT_NAME,
  );
  if (legacyDefault) {
    await db.workspace.update({
      where: { id: legacyDefault.id },
      data:  {
        name:        DEFAULT_WORKSPACE_NAME,
        emoji:       legacyDefault.emoji === "☁️" ? DEFAULT_WORKSPACE_EMOJI : legacyDefault.emoji,
        description: legacyDefault.description ?? DEFAULT_WORKSPACE_DESCRIPTION,
      },
    });
    workspaces = await db.workspace.findMany({
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
