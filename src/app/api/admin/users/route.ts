import { NextRequest } from "next/server";
import { getIdentity, IdentityError } from "@/lib/identity";
import { parseAssignableRole, requireAdmin } from "@/lib/roles";
import {
  CognitoAdminError,
  cognitoAdminAvailable,
  createDirectoryUser,
  listDirectoryUsers,
} from "@/lib/cognito-admin";
import { isMailConfigured, sendWelcomeAddedEmail, appSignInUrl } from "@/lib/mail";
import { directoryPasswordPolicy } from "@/lib/auth-password";
import {
  DEFAULT_MONTHLY_COST_CAP_USD,
  getDefaultMonthlyCostCapUsd,
  getUsersMonthSpendUsd,
  parseMonthlyCostCapInput,
} from "@/lib/cost-cap";
import { ensureUserProfile, setUserMonthlyCostCap } from "@/lib/user-profile";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const identity = await getIdentity(req);
    requireAdmin(identity);
  } catch (err) {
    if (err instanceof IdentityError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

  if (!cognitoAdminAvailable()) {
    return Response.json(
      {
        available: false,
        users: [],
        mailConfigured: isMailConfigured(),
        signInUrl: appSignInUrl(),
        passwordPolicy: directoryPasswordPolicy(),
        defaultMonthlyCostCapUsd: DEFAULT_MONTHLY_COST_CAP_USD,
        error:
          "Cognito is not configured. Set AUTH_MODE=cognito and run npm run floci:cognito for local user admin.",
      },
      { status: 200 },
    );
  }

  try {
    const [users, defaultCap] = await Promise.all([
      listDirectoryUsers(),
      getDefaultMonthlyCostCapUsd(),
    ]);

    const spendByUser = await getUsersMonthSpendUsd(
      users.map(u => u.sub).filter((sub): sub is string => Boolean(sub)),
    );

    const enriched = await Promise.all(
      users.map(async u => {
        let monthlyCostCapUsd: number | null = null;
        let profileStatus: string = "active";
        if (u.sub) {
          const profile = await ensureUserProfile({ userId: u.sub, email: u.email });
          monthlyCostCapUsd = profile.monthlyCostCapUsd;
          profileStatus = profile.status;
        }
        return {
          ...u,
          monthlyCostCapUsd,
          monthSpendUsd: u.sub ? (spendByUser.get(u.sub) ?? 0) : 0,
          profileStatus: profileStatus,
        };
      }),
    );

    return Response.json({
      available: true,
      users: enriched,
      mailConfigured: isMailConfigured(),
      signInUrl: appSignInUrl(),
      passwordPolicy: directoryPasswordPolicy(),
      defaultMonthlyCostCapUsd: defaultCap,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to list users";
    return Response.json(
      {
        available: false,
        users: [],
        mailConfigured: isMailConfigured(),
        signInUrl: appSignInUrl(),
        passwordPolicy: directoryPasswordPolicy(),
        defaultMonthlyCostCapUsd: DEFAULT_MONTHLY_COST_CAP_USD,
        error: msg,
      },
      { status: 502 },
    );
  }
}

export async function POST(req: NextRequest) {
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

  let body: {
    email?: string;
    password?: string;
    role?: string;
    monthlyCostCapUsd?: number | null;
    sendInvite?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (body.role === "owner" || body.role === "super_admin") {
    return Response.json(
      { error: "Super Admin cannot be created through the console. Super Admin is bootstrap-only." },
      { status: 422 },
    );
  }

  const role = parseAssignableRole(body.role);
  const capParsed = parseMonthlyCostCapInput(
    body.monthlyCostCapUsd === undefined
      ? await getDefaultMonthlyCostCapUsd()
      : body.monthlyCostCapUsd,
  );
  if (!capParsed.ok) {
    return Response.json({ error: capParsed.error }, { status: 422 });
  }

  try {
    const user = await createDirectoryUser({
      email: body.email ?? "",
      password: body.password ?? "",
      role,
    });
    if (user.sub && capParsed.value !== undefined) {
      await setUserMonthlyCostCap(user.sub, capParsed.value);
      await ensureUserProfile({ userId: user.sub, email: user.email });
    }
    const emailTo = (user.email ?? body.email ?? "").trim().toLowerCase();
    const sendInvite = body.sendInvite !== false;
    let welcome: { sent: boolean; reason?: string };
    if (!sendInvite) {
      welcome = { sent: false, reason: "skipped" };
    } else if (emailTo) {
      welcome = await sendWelcomeAddedEmail({ to: emailTo, role });
    } else {
      welcome = { sent: false, reason: "not_configured" };
    }
    return Response.json(
      {
        user: {
          ...user,
          monthlyCostCapUsd: capParsed.value ?? null,
          monthSpendUsd: 0,
        },
        welcomeEmail: welcome,
        mailConfigured: isMailConfigured(),
        signInUrl: appSignInUrl(),
        passwordPolicy: directoryPasswordPolicy(),
      },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof CognitoAdminError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    const msg = err instanceof Error ? err.message : "Create failed";
    console.warn("[admin/users]", msg.slice(0, 160));
    return Response.json({ error: msg }, { status: 502 });
  }
}
