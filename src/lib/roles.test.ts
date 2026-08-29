import { describe, expect, it } from "vitest";
import {
  isAdminRole,
  parseAssignableRole,
  roleFromGroups,
  roleLabel,
} from "./roles";

describe("roles", () => {
  it("maps Cognito groups including legacy names", () => {
    expect(roleFromGroups(["Owner"])).toBe("super_admin");
    expect(roleFromGroups(["SuperAdmin"])).toBe("super_admin");
    expect(roleFromGroups(["Admin"])).toBe("admin");
    expect(roleFromGroups(["admin"])).toBe("admin");
    expect(roleFromGroups(["Operator"])).toBe("admin");
    expect(roleFromGroups(["Member"])).toBe("member");
    expect(roleFromGroups([])).toBe("member");
  });

  it("Owner group wins over Admin", () => {
    expect(roleFromGroups(["Admin", "Owner"])).toBe("super_admin");
  });

  it("admin and super admin may manage instance settings", () => {
    expect(isAdminRole("super_admin")).toBe(true);
    expect(isAdminRole("admin")).toBe(true);
    expect(isAdminRole("member")).toBe(false);
  });

  it("parseAssignableRole never returns super_admin", () => {
    expect(parseAssignableRole("admin")).toBe("admin");
    expect(parseAssignableRole("operator")).toBe("admin");
    expect(parseAssignableRole("member")).toBe("member");
    expect(parseAssignableRole("super_admin")).toBe("member");
    expect(parseAssignableRole("owner")).toBe("member");
  });

  it("labels match product names", () => {
    expect(roleLabel("super_admin")).toBe("Super Admin");
    expect(roleLabel("admin")).toBe("Admin");
    expect(roleLabel("member")).toBe("Member");
  });
});
