import { describe, expect, it } from "vitest";

import {
  canAccessDomain,
  canCreateRole,
  canManageAccountStatus,
  isSalesScopeAdmin,
  isWorkforceScopeAdmin,
} from "@/lib/permissions/role-hierarchy";

describe("role hierarchy permissions", () => {
  it("allows each branch administrator to create only its permitted roles", () => {
    expect(canCreateRole("director", "manager")).toBe(true);
    expect(canCreateRole("manager", "hr")).toBe(true);
    expect(canCreateRole("manager", "sales_manager")).toBe(true);
    expect(canCreateRole("manager", "sales")).toBe(true);
    expect(canCreateRole("manager", "chef")).toBe(true);
    expect(canCreateRole("manager", "part_time_chef")).toBe(true);
    expect(canCreateRole("hr", "chef")).toBe(true);
    expect(canCreateRole("hr", "sales")).toBe(false);
    expect(canCreateRole("sales_manager", "sales")).toBe(true);
    expect(canCreateRole("sales_manager", "chef")).toBe(false);
  });

  it("prevents lower roles from changing upper-role account status", () => {
    expect(canManageAccountStatus("hr", "manager")).toBe(false);
    expect(canManageAccountStatus("sales_manager", "hr")).toBe(false);
    expect(canManageAccountStatus("sales", "sales")).toBe(false);
    expect(canManageAccountStatus("manager", "chef")).toBe(true);
  });

  it("keeps provider configuration Director-only", () => {
    expect(canAccessDomain("director", "integration")).toBe(true);
    expect(canAccessDomain("manager", "integration")).toBe(false);
    expect(canAccessDomain("sales_manager", "integration")).toBe(false);
  });

  it("separates sales and workforce branch administrators", () => {
    expect(isSalesScopeAdmin("sales_manager")).toBe(true);
    expect(isSalesScopeAdmin("hr")).toBe(false);
    expect(isWorkforceScopeAdmin("hr")).toBe(true);
    expect(isWorkforceScopeAdmin("sales_manager")).toBe(false);
  });
});
