/**
 * GET    /api/workspaces/:id — get a single workspace with its facts
 * PATCH  /api/workspaces/:id — update workspace settings
 * DELETE /api/workspaces/:id — delete a workspace and everything it owns
 *
 * Every handler resolves the workspace through `findFirst({ id, userId })`
 * rather than `findUnique({ id })`. An id alone must never be sufficient to
 * read or mutate a record. A miss returns 404 rather than 403 so the endpoint
 * does not confirm that an id exists for some other owner.
 */

import { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getIdentity } from "@/lib/identity";

export const runtime = "nodejs";

const MAX_NAME = 60;
const MAX_DESCRIPTION = 140;
const MAX_CONTEXT = 2000;

const NOT_FOUND = () => Response.json({ error: "Workspace not found" }, { status: 404 });

/** Returns undefined when absent, null when explicitly cleared. */
function optional(value: unknown, max: number): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { userId } = await getIdentity(req);

  const workspace = await db.workspace.findFirst({
    where:   { id, userId },
    include: { facts: true },
  });

  if (!workspace) return NOT_FOUND();
  return Response.json(workspace);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { userId } = await getIdentity(req);

  const body = await req.json() as {
    name?: unknown;
    emoji?: unknown;
    color?: unknown;
    description?: unknown;
    context?: unknown;
    modelOverride?: unknown;
  };

  const existing = await db.workspace.findFirst({ where: { id, userId }, select: { id: true } });
  if (!existing) return NOT_FOUND();

  const name = optional(body.name, MAX_NAME);
  if (name === null) {
    return Response.json({ error: "A workspace name is required" }, { status: 400 });
  }

  const data: Prisma.WorkspaceUpdateInput = {
    ...(name                  !== undefined && { name }),
    ...(optional(body.emoji, 8)  !== undefined && { emoji: optional(body.emoji, 8) ?? "🗂️" }),
    ...(optional(body.color, 32) !== undefined && { color: optional(body.color, 32) ?? "#6366f1" }),
    ...(body.description        !== undefined && { description: optional(body.description, MAX_DESCRIPTION) }),
    ...(body.context            !== undefined && { context:     optional(body.context, MAX_CONTEXT) }),
    ...(body.modelOverride      !== undefined && { modelOverride: optional(body.modelOverride, 128) }),
  };

  try {
    const workspace = await db.workspace.update({ where: { id }, data });
    return Response.json(workspace);
  } catch (err) {
    console.error("[workspaces PATCH]", err);
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

  const workspace = await db.workspace.findFirst({ where: { id, userId }, select: { id: true } });
  if (!workspace) return NOT_FOUND();

  const count = await db.workspace.count({ where: { userId } });
  if (count <= 1) {
    return Response.json({ error: "Cannot delete your only workspace" }, { status: 400 });
  }

  await db.workspace.delete({ where: { id } });
  return Response.json({ deleted: true });
}
