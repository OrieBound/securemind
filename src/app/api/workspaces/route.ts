/**
 * GET  /api/workspaces — list the caller's workspaces
 * POST /api/workspaces — create a workspace
 *
 * A workspace is a bounded operational context. It owns its own documents,
 * conversations, and extracted facts, and none of those cross between them.
 */

import { NextRequest } from "next/server";
import { getIdentity } from "@/lib/identity";
import { normalizeWorkspaceColor } from "@/lib/workspaces/color";
import { createWorkspace, listWorkspaces } from "@/lib/workspaces/store";

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
  const workspaces = await listWorkspaces(userId);
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

  const colorInput = clean(body.color, 32);
  const color = colorInput === undefined ? undefined : normalizeWorkspaceColor(colorInput);
  if (colorInput !== undefined && !color) {
    return Response.json({ error: "Use a hex color such as #6366f1." }, { status: 400 });
  }

  const workspace = await createWorkspace(userId, {
    name,
    emoji: clean(body.emoji, 8),
    color: color ?? undefined,
    description: clean(body.description, MAX_DESCRIPTION) ?? null,
    context: clean(body.context, MAX_CONTEXT) ?? null,
  });

  return Response.json(workspace, { status: 201 });
}
