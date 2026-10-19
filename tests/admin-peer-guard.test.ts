import { describe, expect, it } from "vitest";
import { assertCanMutateOwner } from "@/lib/cognito-admin";

const user = (role: "super_admin" | "admin" | "member", sub: string) => ({
  username: sub, sub, email: `${sub}@example.test`, enabled: true, status: "CONFIRMED",
  role, groups: [], createdAt: null, isOwner: role === "super_admin",
});

describe("assertCanMutateOwner — Admin accounts are protected from other Admins", () => {
  it("lets the Super Admin manage anyone", () => {
    expect(() => assertCanMutateOwner(user("admin", "a2"), { role: "super_admin", userId: "o" })).not.toThrow();
  });
  it("stops an Admin changing another Admin", () => {
    expect(() => assertCanMutateOwner(user("admin", "a2"), { role: "admin", userId: "a1" })).toThrow(/Super Admin/);
  });
  it("stops an Admin changing the Super Admin", () => {
    expect(() => assertCanMutateOwner(user("super_admin", "o"), { role: "admin", userId: "a1" })).toThrow();
  });
  it("still lets an Admin manage Members", () => {
    expect(() => assertCanMutateOwner(user("member", "m1"), { role: "admin", userId: "a1" })).not.toThrow();
  });
});
