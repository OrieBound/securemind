/**
 * Workspace / session / message persistence.
 * Local and on-prem: Prisma + Postgres.
 * Hosted Amplify: DynamoDB app records (no Postgres on this install).
 */

import { db } from "@/lib/db";
import { isHostedRuntime } from "@/lib/runtime-env";
import {
  DEFAULT_WORKSPACE_COLOR,
  DEFAULT_WORKSPACE_DESCRIPTION,
  DEFAULT_WORKSPACE_EMOJI,
  DEFAULT_WORKSPACE_NAME,
  LEGACY_DEFAULT_NAMES,
} from "./defaults";
import { defaultWorkspaceHello, isLegacyDefaultHello } from "@/lib/onboarding";
import { hostedAppStore } from "./hosted-dynamo";

export function usesHostedAppStore(): boolean {
  return isHostedRuntime();
}

const prismaListInclude = {
  sessions: {
    orderBy: { updatedAt: "desc" as const },
    take: 1,
    include: {
      messages: { orderBy: { createdAt: "desc" as const }, take: 1 },
    },
  },
};

export async function listWorkspaces(userId: string) {
  if (usesHostedAppStore()) {
    return hostedAppStore().listWorkspaces(userId);
  }

  let workspaces = await db.workspace.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    include: prismaListInclude,
  });

  if (workspaces.length === 0) {
    const initial = await db.workspace.create({
      data: {
        userId,
        name: DEFAULT_WORKSPACE_NAME,
        emoji: DEFAULT_WORKSPACE_EMOJI,
        color: DEFAULT_WORKSPACE_COLOR,
        description: DEFAULT_WORKSPACE_DESCRIPTION,
        isDefault: true,
      },
      include: { sessions: { include: { messages: true } } },
    });
    return [initial];
  }

  const legacyDefault = workspaces.find(
    w =>
      w.isDefault
      && (LEGACY_DEFAULT_NAMES as readonly string[]).includes(w.name),
  );
  if (legacyDefault) {
    await db.workspace.update({
      where: { id: legacyDefault.id },
      data: {
        name: DEFAULT_WORKSPACE_NAME,
        emoji: legacyDefault.emoji === "☁️" ? DEFAULT_WORKSPACE_EMOJI : legacyDefault.emoji,
        description: legacyDefault.description ?? DEFAULT_WORKSPACE_DESCRIPTION,
      },
    });
    workspaces = await db.workspace.findMany({
      where: { userId },
      orderBy: { createdAt: "asc" },
      include: prismaListInclude,
    });
  }

  return workspaces;
}

export async function createWorkspace(
  userId: string,
  input: {
    name: string;
    emoji?: string;
    color?: string;
    description?: string | null;
    context?: string | null;
  },
) {
  if (usesHostedAppStore()) {
    return hostedAppStore().createWorkspace(userId, input);
  }
  return db.workspace.create({
    data: {
      userId,
      name: input.name,
      emoji: input.emoji ?? "🗂️",
      color: input.color ?? DEFAULT_WORKSPACE_COLOR,
      description: input.description ?? null,
      context: input.context ?? null,
      isDefault: false,
    },
  });
}

export async function getWorkspaceWithFacts(userId: string, id: string) {
  if (usesHostedAppStore()) {
    return hostedAppStore().getWorkspace(userId, id);
  }
  return db.workspace.findFirst({
    where: { id, userId },
    include: { facts: true },
  });
}

export async function findOwnedWorkspace(
  userId: string,
  id: string,
): Promise<{ id: string; name: string; context: string | null; isDefault: boolean } | null> {
  if (usesHostedAppStore()) {
    return hostedAppStore().findOwned(userId, id);
  }
  const row = await db.workspace.findFirst({
    where: { id, userId },
    select: { id: true, name: true, context: true, isDefault: true },
  });
  return row;
}

export async function updateWorkspace(
  userId: string,
  id: string,
  data: {
    name?: string;
    emoji?: string;
    color?: string;
    description?: string | null;
    context?: string | null;
    modelOverride?: string | null;
  },
) {
  if (usesHostedAppStore()) {
    return hostedAppStore().updateWorkspace(userId, id, data);
  }
  const existing = await db.workspace.findFirst({ where: { id, userId }, select: { id: true } });
  if (!existing) return null;
  return db.workspace.update({ where: { id }, data });
}

export async function deleteWorkspace(userId: string, id: string): Promise<
  { ok: true } | { ok: false; reason: "not_found" | "last" }
> {
  if (usesHostedAppStore()) {
    const count = await hostedAppStore().countWorkspaces(userId);
    if (count <= 1) return { ok: false, reason: "last" };
    const deleted = await hostedAppStore().deleteWorkspace(userId, id);
    return deleted ? { ok: true } : { ok: false, reason: "not_found" };
  }
  const workspace = await db.workspace.findFirst({ where: { id, userId }, select: { id: true } });
  if (!workspace) return { ok: false, reason: "not_found" };
  const count = await db.workspace.count({ where: { userId } });
  if (count <= 1) return { ok: false, reason: "last" };
  await db.workspace.delete({ where: { id } });
  return { ok: true };
}

const MESSAGE_LIMIT = 200;

export async function loadSession(userId: string, workspaceId: string) {
  if (usesHostedAppStore()) {
    return hostedAppStore().loadSession(userId, workspaceId);
  }

  const owned = await db.workspace.findFirst({
    where: { id: workspaceId, userId },
    select: { id: true, name: true, isDefault: true },
  });
  if (!owned) return null;

  const latestMsg = await db.message.findFirst({
    where: { session: { userId, workspaceId } },
    orderBy: { createdAt: "desc" },
    select: { sessionId: true },
  });

  let session = latestMsg
    ? await db.session.findUnique({
        where: { id: latestMsg.sessionId },
        include: { summary: true },
      })
    : await db.session.findFirst({
        where: { userId, workspaceId },
        orderBy: { updatedAt: "desc" },
        include: { summary: true },
      });

  if (!session) {
    session = await db.session.create({
      data: { userId, workspaceId },
      include: { summary: true },
    });
  }

  if (owned.isDefault) {
    const priorInWorkspace = await db.message.count({
      where: { session: { userId, workspaceId } },
    });
    if (priorInWorkspace === 0) {
      await db.message.create({
        data: {
          sessionId: session.id,
          role: "assistant",
          content: defaultWorkspaceHello(owned.name),
        },
      });
    }
  }

  const [totalCount, recentDesc] = await Promise.all([
    db.message.count({ where: { sessionId: session.id } }),
    db.message.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: "desc" },
      take: MESSAGE_LIMIT,
    }),
  ]);
  const messages = recentDesc.reverse();
  if (owned.isDefault) {
    const first = messages.find(m => m.role === "assistant");
    if (first && isLegacyDefaultHello(first.content)) {
      const content = defaultWorkspaceHello(owned.name);
      await db.message.update({ where: { id: first.id }, data: { content } });
      first.content = content;
    }
  }
  const skipped = Math.max(0, totalCount - messages.length);
  const rawSummarized = session.summary?.turnsCovered ?? 0;
  const summarizedCount = Math.max(0, rawSummarized - skipped);

  const facts = await db.workspaceFact.findMany({
    where: { workspaceId },
    orderBy: { updatedAt: "desc" },
  });
  const extractedFacts: Record<string, string> = {};
  for (const f of facts) extractedFacts[f.key] = f.value;

  return {
    sessionId: session.id,
    workspaceId,
    messages,
    sessionSummary: session.summary?.summary ?? "",
    summarizedCount,
    extractedFacts,
  };
}

export async function appendMessage(
  userId: string,
  sessionId: string,
  role: string,
  content: string,
): Promise<{ id: string } | null> {
  if (usesHostedAppStore()) {
    return hostedAppStore().appendMessage(userId, sessionId, role, content);
  }
  const session = await db.session.findFirst({
    where: { id: sessionId, userId },
    select: { workspaceId: true, userId: true },
  });
  if (!session) return null;
  const message = await db.message.create({
    data: { sessionId, role, content },
  });
  await db.session.update({
    where: { id: sessionId },
    data: { updatedAt: new Date() },
  });
  return { id: message.id };
}
