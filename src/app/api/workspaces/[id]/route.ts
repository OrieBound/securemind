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
import { getIdentity } from "@/lib/identity";
import { scrubServerText } from "@/lib/chat/server-scrub";
import { normalizeWorkspaceColor } from "@/lib/workspaces/color";
import {
  deleteWorkspace,
  getWorkspaceWithFacts,
  updateWorkspace,
} from "@/lib/workspaces/store";

export const runtime = "nodejs";

const MAX_NAME = 60;
const MAX_DESCRIPTION = 140;
const MAX_CONTEXT = 2000;

const NOT_FOUND = () => Response.json({ error: "Workspace not found" }, { status: 404 });

/** Returns undefined when absent, null when explicitly cleared. */
function scrubNullable(value: string | null | undefined): string | null | undefined {
  return typeof value === "string" ? scrubServerText(value) : value;
}

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

  const workspace = await getWorkspaceWithFacts(userId, id);
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

  const name = optional(body.name, MAX_NAME);
  if (name === null) {
    return Response.json({ error: "A workspace name is required" }, { status: 400 });
  }

  const colorInput = optional(body.color, 32);
  const color = colorInput ? normalizeWorkspaceColor(colorInput) : colorInput;
  if (colorInput && !color) {
    return Response.json({ error: "Use a hex color such as #6366f1." }, { status: 400 });
  }

  const data = {
    ...(name !== undefined && { name }),
    ...(optional(body.emoji, 8) !== undefined && { emoji: optional(body.emoji, 8) ?? "🗂️" }),
    ...(color !== undefined && { color: color ?? "#6366f1" }),
    ...(body.description !== undefined && { description: optional(body.description, MAX_DESCRIPTION) }),
    // Context is added to the system prompt on operational turns, so it gets the server gate too.
    ...(body.context !== undefined && { context: scrubNullable(optional(body.context, MAX_CONTEXT)) }),
    ...(body.modelOverride !== undefined && { modelOverride: optional(body.modelOverride, 128) }),
  };

  try {
    const workspace = await updateWorkspace(userId, id, data);
    if (!workspace) return NOT_FOUND();
    return Response.json(workspace);
  } catch (err) {
    // Name only: a database error can echo the submitted values.
    console.error("[workspaces PATCH] update failed:", err instanceof Error ? err.name : "error");
    return Response.json({ error: "Update failed" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { userId } = await getIdentity(req);

  const result = await deleteWorkspace(userId, id);
  if (!result.ok && result.reason === "not_found") return NOT_FOUND();
  if (!result.ok && result.reason === "last") {
    return Response.json({ error: "Cannot delete your only workspace" }, { status: 400 });
  }
  return Response.json({ deleted: true });
}
