/**
 * App-owned UserProfile (display prefs, soft status). Auth stays in Cognito/local.
 */

import { db } from "@/lib/db";
import { usesHostedAppStore } from "@/lib/workspaces/store";
import { hostedAppStore, type HostedProfile } from "@/lib/workspaces/hosted-dynamo";
import {
  DEFAULT_AVATAR_PRESET,
  isAvatarPresetId,
} from "@/lib/avatar-presets";
import { LOCAL_USER_ID } from "@/lib/identity";
import {
  DEFAULT_MONTHLY_COST_CAP_USD,
  getDefaultMonthlyCostCapUsd,
} from "@/lib/cost-cap";

export type ProfileStatus = "active" | "invited" | "suspended" | "deleted";

const RESERVED_HANDLES = new Set([
  "admin",
  "administrator",
  "root",
  "system",
  "securemind",
  "support",
  "api",
  "null",
  "undefined",
  "me",
  "profile",
]);

export type UserProfilePublic = {
  userId: string;
  email: string | null;
  displayName: string | null;
  handle: string | null;
  jobTitle: string | null;
  bio: string | null;
  timezone: string | null;
  locale: string | null;
  avatarPreset: string;
  themePreference: string | null;
  density: string | null;
  defaultLanding: string | null;
  defaultWorkspaceId: string | null;
  preferredModelId: string | null;
  notificationPrefs: unknown;
  status: ProfileStatus;
  /** null = unlimited */
  monthlyCostCapUsd: number | null;
  lastSignInAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

function asStatus(v: string | null | undefined): ProfileStatus {
  if (v === "invited" || v === "suspended" || v === "deleted" || v === "active") return v;
  return "active";
}

function toPublic(row: {
  userId: string;
  email: string | null;
  displayName: string | null;
  handle: string | null;
  jobTitle: string | null;
  bio: string | null;
  timezone: string | null;
  locale: string | null;
  avatarPreset: string;
  themePreference: string | null;
  density: string | null;
  defaultLanding: string | null;
  defaultWorkspaceId: string | null;
  preferredModelId: string | null;
  notificationPrefs: unknown;
  status: string;
  monthlyCostCapUsd: number | null;
  lastSignInAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): UserProfilePublic {
  return {
    userId: row.userId,
    email: row.email,
    displayName: row.displayName,
    handle: row.handle,
    jobTitle: row.jobTitle,
    bio: row.bio,
    timezone: row.timezone,
    locale: row.locale,
    avatarPreset: isAvatarPresetId(row.avatarPreset) ? row.avatarPreset : DEFAULT_AVATAR_PRESET,
    themePreference: row.themePreference,
    density: row.density,
    defaultLanding: row.defaultLanding,
    defaultWorkspaceId: row.defaultWorkspaceId,
    preferredModelId: row.preferredModelId,
    notificationPrefs: row.notificationPrefs,
    status: asStatus(row.status),
    monthlyCostCapUsd: row.monthlyCostCapUsd,
    lastSignInAt: row.lastSignInAt?.toISOString() ?? null,
    deletedAt: row.deletedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function hostedToPublic(row: HostedProfile): UserProfilePublic {
  return toPublic({
    userId: row.userId,
    email: row.email,
    displayName: row.displayName,
    handle: row.handle,
    jobTitle: row.jobTitle,
    bio: row.bio,
    timezone: row.timezone,
    locale: row.locale,
    avatarPreset: row.avatarPreset,
    themePreference: row.themePreference,
    density: row.density,
    defaultLanding: row.defaultLanding,
    defaultWorkspaceId: row.defaultWorkspaceId,
    preferredModelId: row.preferredModelId,
    notificationPrefs: row.notificationPrefs,
    status: row.status,
    monthlyCostCapUsd: row.monthlyCostCapUsd,
    lastSignInAt: row.lastSignInAt ? new Date(row.lastSignInAt) : null,
    deletedAt: row.deletedAt ? new Date(row.deletedAt) : null,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  });
}

function newHostedProfile(opts: {
  userId: string;
  email?: string | null;
  monthlyCostCapUsd: number | null;
  touchSignIn?: boolean;
}): HostedProfile {
  const ts = new Date().toISOString();
  return {
    userId: opts.userId,
    email: opts.email ?? null,
    displayName: opts.email?.split("@")[0] ?? null,
    handle: null,
    jobTitle: null,
    bio: null,
    timezone: null,
    locale: null,
    avatarPreset: DEFAULT_AVATAR_PRESET,
    themePreference: null,
    density: null,
    defaultLanding: null,
    defaultWorkspaceId: null,
    preferredModelId: null,
    notificationPrefs: null,
    status: "active",
    monthlyCostCapUsd: opts.monthlyCostCapUsd,
    lastSignInAt: opts.touchSignIn ? ts : null,
    deletedAt: null,
    deletedByUserId: null,
    createdAt: ts,
    updatedAt: ts,
  };
}

export function normalizeHandle(raw: string): string {
  return raw.trim().toLowerCase().replace(/^@/, "");
}

export function validateHandle(raw: string): { ok: true; handle: string } | { ok: false; reason: string } {
  const handle = normalizeHandle(raw);
  if (handle.length < 3 || handle.length > 32) {
    return { ok: false, reason: "Handle must be 3–32 characters." };
  }
  if (!/^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/.test(handle)) {
    return {
      ok: false,
      reason: "Handle may use letters, numbers, dots, underscores, and hyphens.",
    };
  }
  if (RESERVED_HANDLES.has(handle)) {
    return { ok: false, reason: "That handle is reserved." };
  }
  return { ok: true, handle };
}

export async function ensureUserProfile(opts: {
  userId: string;
  email?: string | null;
  touchSignIn?: boolean;
}): Promise<UserProfilePublic> {
  if (usesHostedAppStore()) {
    const store = hostedAppStore();
    const existing = await store.getProfile(opts.userId);
    if (existing) {
      let next = existing;
      if (opts.email && opts.email !== existing.email) {
        next = { ...next, email: opts.email, updatedAt: new Date().toISOString() };
      }
      if (opts.touchSignIn) {
        next = { ...next, lastSignInAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      }
      if (next !== existing) await store.putProfile(next);
      return hostedToPublic(next);
    }
    const defaultCap =
      opts.userId === LOCAL_USER_ID
        ? null
        : await getDefaultMonthlyCostCapUsd().catch(() => DEFAULT_MONTHLY_COST_CAP_USD);
    const created = newHostedProfile({
      userId: opts.userId,
      email: opts.email,
      monthlyCostCapUsd: defaultCap,
      touchSignIn: opts.touchSignIn,
    });
    await store.putProfile(created);
    return hostedToPublic(created);
  }

  const existing = await db.userProfile.findUnique({ where: { userId: opts.userId } });
  if (existing) {
    const data: { email?: string; lastSignInAt?: Date } = {};
    if (opts.email && opts.email !== existing.email) data.email = opts.email;
    if (opts.touchSignIn) data.lastSignInAt = new Date();
    if (Object.keys(data).length) {
      const updated = await db.userProfile.update({
        where: { userId: opts.userId },
        data,
      });
      return toPublic(updated);
    }
    return toPublic(existing);
  }

  const defaultCap =
    opts.userId === LOCAL_USER_ID
      ? null
      : await getDefaultMonthlyCostCapUsd().catch(() => DEFAULT_MONTHLY_COST_CAP_USD);

  const created = await db.userProfile.create({
    data: {
      userId: opts.userId,
      email: opts.email ?? null,
      displayName: opts.email?.split("@")[0] ?? null,
      avatarPreset: DEFAULT_AVATAR_PRESET,
      status: "active",
      monthlyCostCapUsd: defaultCap,
      lastSignInAt: opts.touchSignIn ? new Date() : null,
    },
  });
  return toPublic(created);
}

/** Admin-only: set monthly cost cap (null = unlimited). */
export async function setUserMonthlyCostCap(
  userId: string,
  monthlyCostCapUsd: number | null,
): Promise<UserProfilePublic> {
  await ensureUserProfile({ userId });
  if (usesHostedAppStore()) {
    const store = hostedAppStore();
    const existing = await store.getProfile(userId);
    if (!existing) throw new Error("Profile missing after ensure.");
    const updated = await store.putProfile({
      ...existing,
      monthlyCostCapUsd,
      updatedAt: new Date().toISOString(),
    });
    return hostedToPublic(updated);
  }
  const updated = await db.userProfile.update({
    where: { userId },
    data: { monthlyCostCapUsd },
  });
  return toPublic(updated);
}

export async function getUserProfile(userId: string): Promise<UserProfilePublic | null> {
  if (usesHostedAppStore()) {
    const row = await hostedAppStore().getProfile(userId);
    return row ? hostedToPublic(row) : null;
  }
  const row = await db.userProfile.findUnique({ where: { userId } });
  return row ? toPublic(row) : null;
}

export type ProfilePatch = {
  displayName?: string | null;
  handle?: string | null;
  jobTitle?: string | null;
  bio?: string | null;
  timezone?: string | null;
  locale?: string | null;
  avatarPreset?: string;
  themePreference?: string | null;
  density?: string | null;
  defaultLanding?: string | null;
  defaultWorkspaceId?: string | null;
  preferredModelId?: string | null;
  notificationPrefs?: unknown;
};

export async function patchUserProfile(
  userId: string,
  patch: ProfilePatch,
): Promise<UserProfilePublic> {
  await ensureUserProfile({ userId });

  const data: Record<string, unknown> = {};

  if ("displayName" in patch) {
    const v = patch.displayName?.trim() || null;
    if (v && v.length > 80) throw Object.assign(new Error("Display name is too long."), { status: 422 });
    data.displayName = v;
  }
  if ("handle" in patch) {
    if (patch.handle == null || patch.handle === "") {
      data.handle = null;
    } else {
      const check = validateHandle(patch.handle);
      if (!check.ok) throw Object.assign(new Error(check.reason), { status: 422 });
      if (!usesHostedAppStore()) {
        const clash = await db.userProfile.findFirst({
          where: { handle: check.handle, NOT: { userId } },
        });
        if (clash) throw Object.assign(new Error("That handle is already taken."), { status: 409 });
      }
      data.handle = check.handle;
    }
  }
  if ("jobTitle" in patch) {
    const v = patch.jobTitle?.trim() || null;
    if (v && v.length > 80) throw Object.assign(new Error("Job title is too long."), { status: 422 });
    data.jobTitle = v;
  }
  if ("bio" in patch) {
    const v = patch.bio?.trim() || null;
    if (v && v.length > 500) throw Object.assign(new Error("Bio is too long."), { status: 422 });
    data.bio = v;
  }
  if ("timezone" in patch) data.timezone = patch.timezone?.trim() || null;
  if ("locale" in patch) data.locale = patch.locale?.trim() || null;
  if ("avatarPreset" in patch) {
    if (!isAvatarPresetId(patch.avatarPreset)) {
      throw Object.assign(new Error("Invalid avatar preset."), { status: 422 });
    }
    data.avatarPreset = patch.avatarPreset;
  }
  if ("themePreference" in patch) {
    const t = patch.themePreference;
    if (t != null && t !== "light" && t !== "dark" && t !== "system") {
      throw Object.assign(new Error("Invalid theme preference."), { status: 422 });
    }
    data.themePreference = t ?? null;
  }
  if ("density" in patch) {
    const d = patch.density;
    if (d != null && d !== "comfortable" && d !== "compact") {
      throw Object.assign(new Error("Invalid density."), { status: 422 });
    }
    data.density = d ?? null;
  }
  if ("defaultLanding" in patch) data.defaultLanding = patch.defaultLanding?.trim() || null;
  if ("defaultWorkspaceId" in patch) data.defaultWorkspaceId = patch.defaultWorkspaceId?.trim() || null;
  if ("preferredModelId" in patch) data.preferredModelId = patch.preferredModelId?.trim() || null;
  if ("notificationPrefs" in patch) data.notificationPrefs = patch.notificationPrefs ?? null;

  if (usesHostedAppStore()) {
    const store = hostedAppStore();
    const existing = await store.getProfile(userId);
    if (!existing) throw new Error("Profile missing after ensure.");
    const updated = await store.putProfile({
      ...existing,
      ...data,
      updatedAt: new Date().toISOString(),
    } as HostedProfile);
    return hostedToPublic(updated);
  }

  const updated = await db.userProfile.update({
    where: { userId },
    data,
  });
  return toPublic(updated);
}

export async function setProfileStatus(opts: {
  userId: string;
  status: ProfileStatus;
  actorUserId: string;
}): Promise<UserProfilePublic> {
  await ensureUserProfile({ userId: opts.userId });
  if (usesHostedAppStore()) {
    const store = hostedAppStore();
    const existing = await store.getProfile(opts.userId);
    if (!existing) throw new Error("Profile missing after ensure.");
    const ts = new Date().toISOString();
    const updated = await store.putProfile({
      ...existing,
      status: opts.status,
      deletedAt: opts.status === "deleted" ? ts : null,
      deletedByUserId: opts.status === "deleted" ? opts.actorUserId : null,
      updatedAt: ts,
    });
    return hostedToPublic(updated);
  }
  const updated = await db.userProfile.update({
    where: { userId: opts.userId },
    data: {
      status: opts.status,
      deletedAt: opts.status === "deleted" ? new Date() : null,
      deletedByUserId: opts.status === "deleted" ? opts.actorUserId : null,
    },
  });
  return toPublic(updated);
}

export async function findProfileByEmailOrSub(
  emailOrUsername: string,
): Promise<{ userId: string } | null> {
  const q = emailOrUsername.trim().toLowerCase();
  if (usesHostedAppStore()) {
    const row = await hostedAppStore().getProfile(q);
    if (row) return { userId: row.userId };
    return null;
  }
  const byEmail = await db.userProfile.findFirst({
    where: { email: { equals: q, mode: "insensitive" } },
    select: { userId: true },
  });
  if (byEmail) return byEmail;
  return db.userProfile.findUnique({ where: { userId: emailOrUsername }, select: { userId: true } });
}
