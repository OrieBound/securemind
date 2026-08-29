import { NextRequest } from "next/server";
import { getIdentity, IdentityError } from "@/lib/identity";
import { parseAssignableRole, requireAdmin, type AppRole } from "@/lib/roles";
import {
  CognitoAdminError,
  adminResetDirectoryUserPassword,
  cognitoAdminAvailable,
  findDirectoryUser,
  listDirectoryUsers,
  setDirectoryUserEnabled,
  setDirectoryUserRole,
} from "@/lib/cognito-admin";
import { setProfileStatus, setUserMonthlyCostCap } from "@/lib/user-profile";
import { getUserMonthSpendUsd, parseMonthlyCostCapInput } from "@/lib/cost-cap";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ username: string }> };

export async function PATCH(req: NextRequest, ctx: Ctx) {
  let identity;
  try {
    identity = await getIdentity(req);
    requireAdmin(identity);
  } catch (err) {
    if (err instanceof IdentityError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

  if (!cognitoAdminAvailable()) {
    return Response.json({ error: "Cognito is not configured." }, { status: 503 });
  }

  const { username: raw } = await ctx.params;
  const username = decodeURIComponent(raw ?? "").trim();
  if (!username) {
    return Response.json({ error: "Username is required." }, { status: 400 });
  }

  let body: {
    role?: string;
    enabled?: boolean;
    status?: "active" | "suspended" | "deleted";
    sendPasswordReset?: boolean;
    monthlyCostCapUsd?: number | null;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const actor = identity.email ?? null;
  const actorOpts = {
    actorUsername: actor,
    actorRole: identity.role as AppRole,
    actorUserId: identity.userId,
  };

  try {
    const targetBefore = await findDirectoryUser(username);
    if (!targetBefore) {
      return Response.json({ error: "User not found." }, { status: 404 });
    }

    const touchingOwner =
      targetBefore.isOwner || targetBefore.role === "super_admin";
    if (touchingOwner && identity.role !== "super_admin") {
      const mutatingProtected =
        typeof body.role === "string"
        || typeof body.enabled === "boolean"
        || body.status === "deleted"
        || body.status === "suspended"
        || body.status === "active"
        || body.sendPasswordReset === true
        || "monthlyCostCapUsd" in body;
      if (mutatingProtected) {
        return Response.json(
          {
            error:
              "Only the Super Admin can change the Super Admin account’s role, status, password, or spend limit.",
          },
          { status: 403 },
        );
      }
    }

    if (body.role === "owner" || body.role === "super_admin") {
      return Response.json(
        { error: "Cannot promote anyone to Super Admin through the console." },
        { status: 422 },
      );
    }

    let user = null;

    if (body.sendPasswordReset === true) {
      await adminResetDirectoryUserPassword(username, actorOpts);
      return Response.json({
        ok: true,
        message:
          "Password reset initiated. The user will receive a code if the account exists and email delivery is configured.",
      });
    }

    if (typeof body.role === "string") {
      const role = parseAssignableRole(body.role);
      user = await setDirectoryUserRole(username, role, actorOpts);
    }

    if (body.status === "deleted" || body.status === "suspended" || body.status === "active") {
      const enable = body.status === "active";
      user = await setDirectoryUserEnabled(username, enable, actorOpts);
      const directory = await listDirectoryUsers();
      const target = directory.find(u => u.username === username || u.email === username);
      if (target?.sub) {
        await setProfileStatus({
          userId: target.sub,
          status: body.status,
          actorUserId: identity.userId,
        });
      }
    } else if (typeof body.enabled === "boolean") {
      user = await setDirectoryUserEnabled(username, body.enabled, actorOpts);
      const directory = await listDirectoryUsers();
      const target = directory.find(u => u.username === username || u.email === username);
      if (target?.sub) {
        await setProfileStatus({
          userId: target.sub,
          status: body.enabled ? "active" : "suspended",
          actorUserId: identity.userId,
        });
      }
    }

    let monthlyCostCapUsd: number | null | undefined;
    if ("monthlyCostCapUsd" in body) {
      const parsed = parseMonthlyCostCapInput(body.monthlyCostCapUsd);
      if (!parsed.ok) {
        return Response.json({ error: parsed.error }, { status: 422 });
      }
      const directory = await listDirectoryUsers();
      const target = directory.find(u => u.username === username || u.email === username);
      if (!target?.sub) {
        return Response.json({ error: "User has no Cognito sub for profile cap." }, { status: 422 });
      }
      const profile = await setUserMonthlyCostCap(target.sub, parsed.value ?? null);
      monthlyCostCapUsd = profile.monthlyCostCapUsd;
      if (!user) user = target;
    }

    if (!user) {
      return Response.json(
        { error: "Provide role, enabled, status, monthlyCostCapUsd, and/or sendPasswordReset." },
        { status: 422 },
      );
    }

    const monthSpendUsd = user.sub ? await getUserMonthSpendUsd(user.sub) : 0;
    return Response.json({
      user: {
        ...user,
        monthlyCostCapUsd:
          monthlyCostCapUsd !== undefined
            ? monthlyCostCapUsd
            : undefined,
        monthSpendUsd,
      },
    });
  } catch (err) {
    if (err instanceof CognitoAdminError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    const msg = err instanceof Error ? err.message : "Update failed";
    console.warn("[admin/users/:id]", msg.slice(0, 160));
    return Response.json({ error: msg }, { status: 502 });
  }
}
