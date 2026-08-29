import type { Identity } from "@/lib/identity";
import { IdentityError } from "@/lib/identity";

/** Super Admin (protected owner) | Admin (elevated staff) | Member. */
export type AppRole = "super_admin" | "admin" | "member";

/** Roles that may be assigned when creating/promoting directory users. Super Admin is bootstrap-only. */
export type AssignableRole = "admin" | "member";

export function isAdminRole(role: AppRole | null | undefined): boolean {
  return role === "super_admin" || role === "admin";
}

export function requireAdmin(identity: Identity): void {
  if (!isAdminRole(identity.role)) {
    throw new IdentityError("Admin access required.", 403);
  }
}

export function requireSuperAdmin(identity: Identity): void {
  if (identity.role !== "super_admin") {
    throw new IdentityError("Super Admin access required.", 403);
  }
}

export function roleLabel(role: AppRole): string {
  if (role === "super_admin") return "Super Admin";
  if (role === "admin") return "Admin";
  return "Member";
}

export function parseAssignableRole(raw: unknown): AssignableRole {
  if (raw === "admin" || raw === "operator") return "admin";
  return "member";
}

/**
 * Map Cognito groups → AppRole.
 * Super Admin > Admin. Legacy Owner → Super Admin; Operator/Admin → Admin.
 */
export function roleFromGroups(groups: string[]): AppRole {
  const normalized = groups.map(g => g.toLowerCase());
  if (
    normalized.includes("owner")
    || normalized.includes("superadmin")
    || normalized.includes("super_admin")
  ) {
    return "super_admin";
  }
  if (normalized.includes("admin") || normalized.includes("operator")) return "admin";
  return "member";
}
