/**
 * Admin-only analytics subject override (?asUser=).
 * Members always see their own identity; admins may observe another user's Insights.
 */

import { db } from "@/lib/db";
import type { Identity } from "@/lib/identity";
import { IdentityError } from "@/lib/identity";
import { requireAdmin } from "@/lib/roles";
import { hostedAppStore } from "@/lib/workspaces/hosted-dynamo";
import { usesHostedAppStore } from "@/lib/workspaces/store";

export type AnalyticsSubjectOk = {
  ok: true;
  /** Effective userId for queries / workspace scope. */
  userId: string;
  /** True when an admin is viewing another account (or self via asUser). */
  adminScoped: boolean;
};

export type AnalyticsSubjectErr = {
  ok: false;
  status: number;
  error: string;
};

/**
 * Resolve who analytics GET handlers should query for.
 * - No asUser → caller's identity
 * - asUser present → requireAdmin, then validate subject exists (404 if unknown)
 */
export async function resolveAnalyticsSubject(
  identity: Identity,
  asUserRaw: string | null | undefined,
): Promise<AnalyticsSubjectOk | AnalyticsSubjectErr> {
  const asUser = typeof asUserRaw === "string" ? asUserRaw.trim() : "";
  if (!asUser) {
    return { ok: true, userId: identity.userId, adminScoped: false };
  }

  try {
    requireAdmin(identity);
  } catch (err) {
    if (err instanceof IdentityError) {
      return { ok: false, status: err.status, error: err.message };
    }
    throw err;
  }

  if (asUser.length > 128) {
    return { ok: false, status: 404, error: "User not found" };
  }

  // Viewing self via asUser is always allowed for admins.
  if (asUser === identity.userId) {
    return { ok: true, userId: asUser, adminScoped: true };
  }

  const known = await isKnownAnalyticsSubject(asUser);
  if (!known) {
    return { ok: false, status: 404, error: "User not found" };
  }

  return { ok: true, userId: asUser, adminScoped: true };
}

/** Subject has left a footprint we can attribute Insights to. */
export async function isKnownAnalyticsSubject(userId: string): Promise<boolean> {
  if (usesHostedAppStore()) {
    const store = hostedAppStore();
    const [profile, workspaceCount, inference, security] = await Promise.all([
      store.getProfile(userId),
      store.countWorkspaces(userId),
      store.listInferenceEvents(userId, { take: 1 }),
      store.listSecurityEvents(userId, { take: 1 }),
    ]);
    return Boolean(profile || workspaceCount > 0 || inference.length || security.length);
  }
  const [profile, workspace, inference, security] = await Promise.all([
    db.userProfile.findUnique({
      where: { userId },
      select: { userId: true },
    }),
    db.workspace.findFirst({
      where: { userId },
      select: { id: true },
    }),
    db.inferenceEvent.findFirst({
      where: { userId },
      select: { id: true },
    }),
    db.securityEvent.findFirst({
      where: { userId },
      select: { id: true },
    }),
  ]);
  return Boolean(profile || workspace || inference || security);
}

export type InsightsSubjectMeta = {
  userId: string;
  label: string;
  email: string | null;
  workspaces: { id: string; name: string }[];
};

/** Admin-only metadata for the Insights drill-down banner + workspace filter. */
export async function getInsightsSubjectMeta(userId: string): Promise<InsightsSubjectMeta | null> {
  if (!(await isKnownAnalyticsSubject(userId))) return null;

  const [profile, workspaces] = usesHostedAppStore()
    ? await Promise.all([
        hostedAppStore().getProfile(userId),
        hostedAppStore().peekWorkspaces(userId),
      ]).then(([p, ws]) => [
        p ? { email: p.email, displayName: p.displayName } : null,
        ws.map(w => ({ id: w.id, name: w.name })).sort((a, b) => a.name.localeCompare(b.name)),
      ] as const)
    : await Promise.all([
        db.userProfile.findUnique({
          where: { userId },
          select: { email: true, displayName: true },
        }),
        db.workspace.findMany({
          where: { userId },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        }),
      ]);

  const email = profile?.email ?? null;
  const label =
    profile?.displayName?.trim() ||
    email ||
    (userId === "local" ? "Local user" : `${userId.slice(0, 12)}…`);

  return {
    userId,
    label,
    email,
    workspaces,
  };
}
