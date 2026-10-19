/**
 * PATCH /api/memory/facts/[id]  — correct, pin, or forget a fact
 * DELETE /api/memory/facts/[id] — permanently remove a fact
 */

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getIdentity } from "@/lib/identity";
import { postgresMemory } from "@/lib/storage/postgres";
import { hostedAppStore } from "@/lib/workspaces/hosted-dynamo";
import { usesHostedAppStore } from "@/lib/workspaces/store";

type Params = { params: Promise<{ id: string }> };

async function workspaceIdOf(req: NextRequest): Promise<string | null> {
  const fromQuery = new URL(req.url).searchParams.get("workspaceId");
  if (fromQuery) return fromQuery;
  try {
    const body = await req.clone().json() as { workspaceId?: string };
    return typeof body.workspaceId === "string" ? body.workspaceId : null;
  } catch {
    return null;
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { userId } = await getIdentity(req);
  const workspaceId = await workspaceIdOf(req);
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
  }

  let body: { value?: string; pinned?: boolean; forgotten?: boolean };
  try {
    body = await req.json() as { value?: string; pinned?: boolean; forgotten?: boolean };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (usesHostedAppStore()) {
    const store = hostedAppStore();
    const existing = await store.getFactById(userId, workspaceId, id);
    if (!existing) {
      return NextResponse.json({ error: "Fact not found" }, { status: 404 });
    }
    const updated = await store.putFact({
      ...existing,
      value: typeof body.value === "string" ? body.value : existing.value,
      pinned: typeof body.pinned === "boolean" ? body.pinned : existing.pinned,
      forgotten: typeof body.forgotten === "boolean" ? body.forgotten : existing.forgotten,
      correctedAt: new Date().toISOString(),
      correctedByUserId: userId,
      updatedAt: new Date().toISOString(),
    });
    return NextResponse.json(updated);
  }

  const updated = await postgresMemory.patchFact(userId, workspaceId, id, {
    value: typeof body.value === "string" ? body.value : undefined,
    pinned: typeof body.pinned === "boolean" ? body.pinned : undefined,
    forgotten: typeof body.forgotten === "boolean" ? body.forgotten : undefined,
  });
  if (!updated) {
    return NextResponse.json({ error: "Fact not found" }, { status: 404 });
  }
  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const { userId } = await getIdentity(req);
  const workspaceId = await workspaceIdOf(req);
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
  }
  if (usesHostedAppStore()) {
    const deleted = await hostedAppStore().deleteFact(userId, workspaceId, id);
    if (!deleted) {
      return NextResponse.json({ error: "Fact not found" }, { status: 404 });
    }
    return new Response(null, { status: 204 });
  }

  const ok = await postgresMemory.deleteFact(userId, workspaceId, id);
  if (!ok) {
    return NextResponse.json({ error: "Fact not found" }, { status: 404 });
  }
  return new Response(null, { status: 204 });
}
