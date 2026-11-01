/**
 * GET  /api/bookmarks?workspaceId=
 * POST /api/bookmarks  { workspaceId, messageId, label, preview, role?, heavy? }
 * POST with { migrate: true, workspaceId, items: [...] } imports localStorage once.
 * DELETE /api/bookmarks?workspaceId=&messageId=
 */

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getIdentity } from "@/lib/identity";
import { hostedAppStore, type HostedSavedItem } from "@/lib/workspaces/hosted-dynamo";
import { findOwnedWorkspace, usesHostedAppStore } from "@/lib/workspaces/store";

async function assertWorkspace(userId: string, workspaceId: string) {
  if (usesHostedAppStore()) {
    return findOwnedWorkspace(userId, workspaceId);
  }
  return db.workspace.findFirst({
    where: { id: workspaceId, userId },
    select: { id: true },
  });
}

function hostedBookmark(input: {
  userId: string;
  workspaceId: string;
  messageId: string;
  label?: string;
  preview?: string;
  role?: string | null;
  heavy?: boolean;
  createdAt?: string;
  existing?: HostedSavedItem | null;
}): HostedSavedItem {
  return {
    id: input.existing?.id ?? crypto.randomUUID(),
    userId: input.userId,
    workspaceId: input.workspaceId,
    messageId: input.messageId,
    label: (input.label ?? input.existing?.label ?? "Bookmark").slice(0, 120),
    preview: (input.preview ?? input.existing?.preview ?? "").slice(0, 400),
    role: input.role ?? input.existing?.role ?? null,
    heavy: Boolean(input.heavy ?? input.existing?.heavy),
    createdAt: input.existing?.createdAt ?? input.createdAt ?? new Date().toISOString(),
  };
}

export async function GET(req: NextRequest) {
  const { userId } = await getIdentity(req);
  const workspaceId = new URL(req.url).searchParams.get("workspaceId");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
  }
  const owned = await assertWorkspace(userId, workspaceId);
  if (!owned) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  if (usesHostedAppStore()) {
    const items = await hostedAppStore().listBookmarks(userId, workspaceId);
    return NextResponse.json({ items });
  }

  const items = await db.savedItem.findMany({
    where: { userId, workspaceId },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ items });
}

export async function POST(req: NextRequest) {
  const { userId } = await getIdentity(req);
  let body: {
    workspaceId?: string;
    messageId?: string;
    label?: string;
    preview?: string;
    role?: string;
    heavy?: boolean;
    migrate?: boolean;
    items?: Array<{
      messageId: string;
      label?: string;
      preview?: string;
      role?: string;
      heavy?: boolean;
      createdAt?: string;
    }>;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const workspaceId = body.workspaceId;
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
  }
  const owned = await assertWorkspace(userId, workspaceId);
  if (!owned) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  if (body.migrate && Array.isArray(body.items)) {
    if (usesHostedAppStore()) {
      const store = hostedAppStore();
      const existing = await store.listBookmarks(userId, workspaceId);
      const byMessage = new Map(existing.map(i => [i.messageId, i]));
      for (const item of body.items.slice(0, 200)) {
        if (!item.messageId || byMessage.has(item.messageId)) continue;
        const row = hostedBookmark({
          userId,
          workspaceId,
          messageId: item.messageId,
          label: item.label,
          preview: item.preview,
          role: item.role,
          heavy: item.heavy,
          createdAt: item.createdAt,
        });
        await store.putBookmark(row);
        byMessage.set(item.messageId, row);
      }
      const items = await store.listBookmarks(userId, workspaceId);
      return NextResponse.json({ items, migrated: true });
    }
    for (const item of body.items.slice(0, 200)) {
      if (!item.messageId) continue;
      await db.savedItem.upsert({
        where: {
          userId_workspaceId_messageId: {
            userId,
            workspaceId,
            messageId: item.messageId,
          },
        },
        update: {},
        create: {
          userId,
          workspaceId,
          messageId: item.messageId,
          label: (item.label ?? "Bookmark").slice(0, 120),
          preview: (item.preview ?? "").slice(0, 400),
          role: item.role ?? null,
          heavy: Boolean(item.heavy),
        },
      });
    }
    const items = await db.savedItem.findMany({
      where: { userId, workspaceId },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ items, migrated: true });
  }

  if (!body.messageId) {
    return NextResponse.json({ error: "messageId required" }, { status: 400 });
  }

  if (usesHostedAppStore()) {
    const store = hostedAppStore();
    const existing = (await store.listBookmarks(userId, workspaceId)).find(
      i => i.messageId === body.messageId,
    );
    const item = await store.putBookmark(
      hostedBookmark({
        userId,
        workspaceId,
        messageId: body.messageId,
        label: body.label,
        preview: body.preview,
        role: body.role,
        heavy: body.heavy,
        existing,
      }),
    );
    return NextResponse.json(item, { status: 201 });
  }

  const item = await db.savedItem.upsert({
    where: {
      userId_workspaceId_messageId: {
        userId,
        workspaceId,
        messageId: body.messageId,
      },
    },
    update: {
      label: (body.label ?? "Bookmark").slice(0, 120),
      preview: (body.preview ?? "").slice(0, 400),
      role: body.role ?? null,
      heavy: Boolean(body.heavy),
    },
    create: {
      userId,
      workspaceId,
      messageId: body.messageId,
      label: (body.label ?? "Bookmark").slice(0, 120),
      preview: (body.preview ?? "").slice(0, 400),
      role: body.role ?? null,
      heavy: Boolean(body.heavy),
    },
  });
  return NextResponse.json(item, { status: 201 });
}

export async function DELETE(req: NextRequest) {
  const { userId } = await getIdentity(req);
  const url = new URL(req.url);
  const workspaceId = url.searchParams.get("workspaceId");
  const messageId = url.searchParams.get("messageId");
  if (!workspaceId || !messageId) {
    return NextResponse.json({ error: "workspaceId and messageId required" }, { status: 400 });
  }
  const owned = await assertWorkspace(userId, workspaceId);
  if (!owned) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  if (usesHostedAppStore()) {
    const deleted = await hostedAppStore().deleteBookmark(userId, workspaceId, messageId);
    if (!deleted) {
      return NextResponse.json({ error: "Bookmark not found" }, { status: 404 });
    }
    return new Response(null, { status: 204 });
  }

  const existing = await db.savedItem.findFirst({
    where: { userId, workspaceId, messageId },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Bookmark not found" }, { status: 404 });
  }
  await db.savedItem.delete({ where: { id: existing.id } });
  return new Response(null, { status: 204 });
}
