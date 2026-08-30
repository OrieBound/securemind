export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getIdentity, identityErrorResponse } from "@/lib/identity";
import {
  ensureUserProfile,
  patchUserProfile,
  type ProfilePatch,
} from "@/lib/user-profile";
import { listWorkspaces } from "@/lib/workspaces/store";
import { getUserCostCapStatus } from "@/lib/cost-cap";

export async function GET(req: NextRequest) {
  try {
    const identity = await getIdentity(req);
    const [profile, monthCap, workspaces] = await Promise.all([
      ensureUserProfile({
        userId: identity.userId,
        email: identity.email ?? null,
      }),
      getUserCostCapStatus(identity.userId),
      listWorkspaces(identity.userId).then(rows =>
        rows
          .map(w => ({
            id: w.id,
            name: w.name,
            emoji: w.emoji,
            isDefault: w.isDefault,
          }))
          .slice(0, 50),
      ),
    ]);
    return Response.json({
      profile,
      role: identity.role,
      authenticated: identity.authenticated,
      workspaces,
      monthCap: {
        spentUsd: monthCap.spentUsd,
        capUsd: monthCap.capUsd,
        resetsAt: monthCap.resetsAt,
        capped: monthCap.capped,
        warningLevel: monthCap.warningLevel,
      },
    });
  } catch (err) {
    const res = identityErrorResponse(err);
    if (res) return res;
    throw err;
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const identity = await getIdentity(req);
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "Invalid JSON" }, { status: 400 });
    }

    // Reject privileged / identity fields even if smuggled
    for (const banned of [
      "userId",
      "role",
      "status",
      "email",
      "deletedAt",
      "deletedByUserId",
      "groups",
      "authenticated",
      "monthlyCostCapUsd",
    ]) {
      if (banned in body) {
        return Response.json({ error: `Field "${banned}" cannot be changed here.` }, { status: 422 });
      }
    }

    const patch: ProfilePatch = {};
    const keys: (keyof ProfilePatch)[] = [
      "displayName",
      "handle",
      "jobTitle",
      "bio",
      "timezone",
      "locale",
      "avatarPreset",
      "themePreference",
      "density",
      "defaultLanding",
      "defaultWorkspaceId",
      "preferredModelId",
      "notificationPrefs",
    ];
    for (const k of keys) {
      if (k in body) (patch as Record<string, unknown>)[k] = body[k];
    }

    try {
      const profile = await patchUserProfile(identity.userId, patch);
      return Response.json({ profile, role: identity.role });
    } catch (err) {
      const e = err as Error & { status?: number };
      if (e.status === 422 || e.status === 409) {
        return Response.json({ error: e.message }, { status: e.status });
      }
      throw err;
    }
  } catch (err) {
    const res = identityErrorResponse(err);
    if (res) return res;
    throw err;
  }
}
