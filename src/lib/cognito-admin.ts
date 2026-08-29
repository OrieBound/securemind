/**
 * Cognito Admin APIs for the SecureMind Admin console.
 *
 * Used only from admin-gated routes. Supports Floci (local) and real Cognito
 * via the same client wiring as `cognito.ts` (issuer-origin endpoint).
 *
 * Roles are Cognito groups: Owner (Super Admin) | Admin | Member.
 * Legacy Operator group maps to Admin. Super Admin is designated via InstanceConfig.ownerUserId.
 */

import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminListGroupsForUserCommand,
  AdminRemoveUserFromGroupCommand,
  AdminSetUserPasswordCommand,
  AdminResetUserPasswordCommand,
  ListUsersCommand,
  type UserType,
} from "@aws-sdk/client-cognito-identity-provider";
import { CognitoIdentityProviderClient } from "@aws-sdk/client-cognito-identity-provider";
import { LOCAL_AWS_CREDENTIALS, LOCAL_AWS_ENDPOINT } from "@/lib/aws-endpoint";
import { roleFromGroups as mapGroupsToRole, type AppRole, type AssignableRole } from "@/lib/roles";
import { db } from "@/lib/db";

export const GROUP_OWNER = "Owner";
/** @deprecated Legacy group — treated as Admin. */
export const GROUP_OPERATOR = "Operator";
export const GROUP_ADMIN = "Admin";
export const GROUP_MEMBER = "Member";

export type DirectoryUser = {
  username: string;
  sub: string | null;
  email: string | null;
  enabled: boolean;
  status: string;
  role: AppRole;
  groups: string[];
  createdAt: string | null;
  isOwner: boolean;
};

function region(): string {
  return (
    process.env.COGNITO_REGION ||
    process.env.AWS_REGION ||
    process.env.AWS_DEFAULT_REGION ||
    "us-east-1"
  );
}

function requirePoolId(): string {
  const id = process.env.COGNITO_USER_POOL_ID?.trim();
  if (!id) throw new CognitoAdminError("COGNITO_USER_POOL_ID is not set.", 503);
  return id;
}

function cognitoEndpoint(): string | undefined {
  const issuer = process.env.COGNITO_ISSUER?.trim();
  if (issuer) {
    try {
      return new URL(issuer).origin;
    } catch {
      /* fall through */
    }
  }
  return LOCAL_AWS_ENDPOINT;
}

let _client: CognitoIdentityProviderClient | null = null;
let _endpoint: string | undefined;

function cip(): CognitoIdentityProviderClient {
  const endpoint = cognitoEndpoint();
  if (!_client || _endpoint !== endpoint) {
    _client = new CognitoIdentityProviderClient({
      region: region(),
      ...(endpoint ? { endpoint } : {}),
      credentials: LOCAL_AWS_CREDENTIALS,
    });
    _endpoint = endpoint;
  }
  return _client;
}

export class CognitoAdminError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "CognitoAdminError";
    this.status = status;
  }
}

export function cognitoAdminAvailable(): boolean {
  return Boolean(process.env.COGNITO_USER_POOL_ID && process.env.COGNITO_CLIENT_ID);
}

function attr(user: UserType, name: string): string | null {
  return user.Attributes?.find(a => a.Name === name)?.Value ?? null;
}

async function groupsForUsername(username: string): Promise<string[]> {
  const out = await cip().send(
    new AdminListGroupsForUserCommand({
      UserPoolId: requirePoolId(),
      Username: username,
    }),
  );
  return (out.Groups ?? []).map(g => g.GroupName).filter((g): g is string => Boolean(g));
}

async function getOwnerUserId(): Promise<string | null> {
  try {
    const row = await db.instanceConfig.findUnique({
      where: { id: "singleton" },
      select: { ownerUserId: true },
    });
    return row?.ownerUserId ?? null;
  } catch {
    return null;
  }
}

async function setOwnerUserId(userId: string): Promise<void> {
  await db.instanceConfig.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", ownerUserId: userId },
    update: { ownerUserId: userId },
  });
}

function roleForDirectory(groups: string[], sub: string | null, ownerUserId: string | null): AppRole {
  if (ownerUserId && sub && sub === ownerUserId) return "super_admin";
  return mapGroupsToRole(groups);
}

function toDirectoryUser(
  user: UserType,
  groups: string[],
  ownerUserId: string | null,
): DirectoryUser {
  const sub = attr(user, "sub");
  const role = roleForDirectory(groups, sub, ownerUserId);
  return {
    username: user.Username ?? "",
    sub,
    email: attr(user, "email") ?? user.Username ?? null,
    enabled: user.Enabled !== false,
    status: user.UserStatus ?? "UNKNOWN",
    role,
    groups,
    createdAt: user.UserCreateDate?.toISOString() ?? null,
    isOwner: role === "super_admin",
  };
}

async function ensureOwnerGroup(username: string): Promise<void> {
  const pool = requirePoolId();
  try {
    await cip().send(
      new AdminAddUserToGroupCommand({
        UserPoolId: pool,
        Username: username,
        GroupName: GROUP_OWNER,
      }),
    );
  } catch {
    /* group may not exist yet on legacy pools */
  }
}

/**
 * If ownerUserId is unset, pick the first enabled Owner/Admin/Operator user and persist.
 * Ensures that user is in the Owner Cognito group when possible.
 */
export async function ensureOwnerBootstrap(users?: DirectoryUser[]): Promise<string | null> {
  let ownerUserId = await getOwnerUserId();
  if (ownerUserId) return ownerUserId;

  const directory = users ?? (await listDirectoryUsersRaw());
  const candidate =
    directory.find(u => u.enabled && u.groups.some(g => g.toLowerCase() === "owner"))
    ?? directory.find(u =>
      u.enabled && u.groups.some(g => {
        const n = g.toLowerCase();
        return n === "admin" || n === "operator";
      }),
    )
    ?? directory.find(u => u.enabled);

  if (!candidate?.sub) return null;

  await setOwnerUserId(candidate.sub);
  await ensureOwnerGroup(candidate.username);
  return candidate.sub;
}

async function listDirectoryUsersRaw(): Promise<DirectoryUser[]> {
  const pool = requirePoolId();
  const ownerUserId = await getOwnerUserId();
  const users: UserType[] = [];
  let paginationToken: string | undefined;
  do {
    const page = await cip().send(
      new ListUsersCommand({
        UserPoolId: pool,
        Limit: 60,
        PaginationToken: paginationToken,
      }),
    );
    users.push(...(page.Users ?? []));
    paginationToken = page.PaginationToken;
  } while (paginationToken);

  const result: DirectoryUser[] = [];
  for (const u of users) {
    if (!u.Username) continue;
    const groups = await groupsForUsername(u.Username);
    result.push(toDirectoryUser(u, groups, ownerUserId));
  }
  result.sort((a, b) => (a.email ?? a.username).localeCompare(b.email ?? b.username));
  return result;
}

/** List users in the pool with Owner/Operator/Member role (bootstraps Owner once). */
export async function listDirectoryUsers(): Promise<DirectoryUser[]> {
  const raw = await listDirectoryUsersRaw();
  const ownerUserId = await ensureOwnerBootstrap(raw);
  if (!ownerUserId) return raw;
  return raw.map(u => {
    if (u.sub === ownerUserId) {
      return { ...u, role: "super_admin" as const, isOwner: true };
    }
    return u;
  });
}

function assertCanMutateOwner(
  target: DirectoryUser,
  actor: { role: AppRole; userId?: string | null },
): void {
  if (!target.isOwner && target.role !== "super_admin") return;
  if (actor.role === "super_admin") return;
  throw new CognitoAdminError(
    "Only the Super Admin can change the Super Admin account’s role, status, password, or spend limit.",
    403,
  );
}

export async function createDirectoryUser(input: {
  email: string;
  password: string;
  role: AssignableRole;
}): Promise<DirectoryUser> {
  const email = input.email.trim().toLowerCase();
  const password = input.password;
  if (!email || !email.includes("@")) {
    throw new CognitoAdminError("A valid email is required.");
  }
  if (password.length < 8) {
    throw new CognitoAdminError("Password must be at least 8 characters.");
  }
  if (input.role !== "admin" && input.role !== "member") {
    throw new CognitoAdminError("Role must be Admin or Member.", 422);
  }

  const pool = requirePoolId();
  try {
    await cip().send(
      new AdminCreateUserCommand({
        UserPoolId: pool,
        Username: email,
        UserAttributes: [
          { Name: "email", Value: email },
          { Name: "email_verified", Value: "true" },
        ],
        MessageAction: "SUPPRESS",
      }),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/UsernameExistsException|already exists/i.test(msg)) {
      throw new CognitoAdminError("A user with that email already exists.", 409);
    }
    throw err;
  }

  await cip().send(
    new AdminSetUserPasswordCommand({
      UserPoolId: pool,
      Username: email,
      Password: password,
      Permanent: true,
    }),
  );

  const primaryGroup = input.role === "admin" ? GROUP_ADMIN : GROUP_MEMBER;
  try {
    await cip().send(
      new AdminAddUserToGroupCommand({
        UserPoolId: pool,
        Username: email,
        GroupName: primaryGroup,
      }),
    );
  } catch {
    if (input.role === "admin") {
      await cip().send(
        new AdminAddUserToGroupCommand({
          UserPoolId: pool,
          Username: email,
          GroupName: GROUP_ADMIN,
        }),
      );
    } else {
      throw new CognitoAdminError(`Could not add user to group ${primaryGroup}.`, 502);
    }
  }

  if (input.role === "admin") {
    try {
      await cip().send(
        new AdminAddUserToGroupCommand({
          UserPoolId: pool,
          Username: email,
          GroupName: GROUP_MEMBER,
        }),
      );
    } catch {
      /* optional */
    }
  }

  const listed = await listDirectoryUsers();
  const created = listed.find(u => u.username === email || u.email === email);
  if (!created) throw new CognitoAdminError("User created but could not be reloaded.", 500);
  return created;
}

export async function setDirectoryUserRole(
  username: string,
  role: AssignableRole,
  opts?: { actorUsername?: string | null; actorRole?: AppRole; actorUserId?: string | null },
): Promise<DirectoryUser> {
  const pool = requirePoolId();
  const users = await listDirectoryUsers();
  const target = users.find(u => u.username === username || u.email === username);
  if (!target) throw new CognitoAdminError("User not found.", 404);

  assertCanMutateOwner(target, {
    role: opts?.actorRole ?? "member",
    userId: opts?.actorUserId,
  });

  if (role !== "admin" && role !== "member") {
    throw new CognitoAdminError("Cannot assign that role. Super Admin is bootstrap-only.", 422);
  }

  if (role === "member" && (target.role === "admin" || target.role === "super_admin")) {
    const elevated = users.filter(
      u => (u.role === "super_admin" || u.role === "admin") && u.enabled,
    );
    if (elevated.length <= 1) {
      throw new CognitoAdminError("Cannot demote the last Admin or Super Admin.", 422);
    }
  }

  // Clear elevated groups, then add the target role.
  for (const g of [GROUP_OWNER, GROUP_OPERATOR, GROUP_ADMIN]) {
    try {
      await cip().send(
        new AdminRemoveUserFromGroupCommand({
          UserPoolId: pool,
          Username: target.username,
          GroupName: g,
        }),
      );
    } catch {
      /* already absent */
    }
  }

  if (role === "admin") {
    try {
      await cip().send(
        new AdminAddUserToGroupCommand({
          UserPoolId: pool,
          Username: target.username,
          GroupName: GROUP_OPERATOR,
        }),
      );
    } catch {
      await cip().send(
        new AdminAddUserToGroupCommand({
          UserPoolId: pool,
          Username: target.username,
          GroupName: GROUP_ADMIN,
        }),
      );
    }
  }

  try {
    await cip().send(
      new AdminAddUserToGroupCommand({
        UserPoolId: pool,
        Username: target.username,
        GroupName: GROUP_MEMBER,
      }),
    );
  } catch {
    /* already present */
  }

  const groups = await groupsForUsername(target.username);
  const ownerUserId = await getOwnerUserId();
  return {
    ...target,
    groups,
    role: roleForDirectory(groups, target.sub, ownerUserId),
    isOwner: Boolean(ownerUserId && target.sub === ownerUserId),
  };
}

export async function setDirectoryUserEnabled(
  username: string,
  enabled: boolean,
  opts?: { actorUsername?: string | null; actorRole?: AppRole; actorUserId?: string | null },
): Promise<DirectoryUser> {
  const pool = requirePoolId();
  const users = await listDirectoryUsers();
  const target = users.find(u => u.username === username || u.email === username);
  if (!target) throw new CognitoAdminError("User not found.", 404);

  assertCanMutateOwner(target, {
    role: opts?.actorRole ?? "member",
    userId: opts?.actorUserId,
  });

  if (
    !enabled
    && opts?.actorUsername
    && (opts.actorUsername === target.username || opts.actorUsername === target.email)
  ) {
    throw new CognitoAdminError("You cannot disable your own account.", 422);
  }

  if (!enabled && (target.role === "super_admin" || target.role === "admin")) {
    const otherElevated = users.filter(
      u =>
        (u.role === "super_admin" || u.role === "admin")
        && u.enabled
        && u.username !== target.username,
    );
    if (otherElevated.length === 0) {
      throw new CognitoAdminError("Cannot disable the last enabled Admin or Super Admin.", 422);
    }
  }

  await cip().send(
    enabled
      ? new AdminEnableUserCommand({ UserPoolId: pool, Username: target.username })
      : new AdminDisableUserCommand({ UserPoolId: pool, Username: target.username }),
  );

  return { ...target, enabled };
}

/** Triggers Cognito's forgot-password email/code for the user. Never sets a plaintext password. */
export async function adminResetDirectoryUserPassword(
  username: string,
  opts?: { actorRole?: AppRole; actorUserId?: string | null },
): Promise<void> {
  const pool = requirePoolId();
  const users = await listDirectoryUsers();
  const target = users.find(u => u.username === username || u.email === username);
  if (!target) throw new CognitoAdminError("User not found.", 404);

  assertCanMutateOwner(target, {
    role: opts?.actorRole ?? "member",
    userId: opts?.actorUserId,
  });

  await cip().send(
    new AdminResetUserPasswordCommand({
      UserPoolId: pool,
      Username: target.username,
    }),
  );
}

export async function findDirectoryUser(
  username: string,
): Promise<DirectoryUser | null> {
  const users = await listDirectoryUsers();
  return users.find(u => u.username === username || u.email === username) ?? null;
}
