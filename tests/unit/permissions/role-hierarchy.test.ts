import { describe, expect, it } from "vitest";

import {
  canAccessDomain,
  canCreateRole,
  canManageAccountStatus,
  isFranchiseScopedRole,
  isOrganizationAdmin,
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

  it("lets only the Director create a Franchise Owner", () => {
    expect(canCreateRole("director", "franchise")).toBe(true);
    expect(canCreateRole("franchise", "franchise")).toBe(false);
    expect(canCreateRole("manager", "franchise")).toBe(false);
    expect(canCreateRole("hr", "franchise")).toBe(false);
    expect(canCreateRole("sales_manager", "franchise")).toBe(false);
  });

  it("gives a Franchise Owner the full team below it", () => {
    for (const role of ["manager", "hr", "sales_manager", "sales", "chef", "part_time_chef"] as const) {
      expect(canCreateRole("franchise", role)).toBe(true);
      expect(canManageAccountStatus("franchise", role)).toBe(true);
    }
  });

  it("stops a Manager from administering the Franchise Owner above it", () => {
    expect(canManageAccountStatus("manager", "franchise")).toBe(false);
    expect(canManageAccountStatus("franchise", "director")).toBe(false);
  });

  it("keeps organization ownership with the Director alone", () => {
    expect(isOrganizationAdmin("director")).toBe(true);
    expect(isOrganizationAdmin("franchise")).toBe(false);
    expect(canAccessDomain("franchise", "integration")).toBe(false);
    expect(canAccessDomain("franchise", "organization")).toBe(false);
  });

  it("treats a Franchise Owner as an operational admin inside its franchise", () => {
    expect(isSalesScopeAdmin("franchise")).toBe(true);
    expect(isWorkforceScopeAdmin("franchise")).toBe(true);
    expect(canAccessDomain("franchise", "payroll")).toBe(true);
  });

  it("pins every role except the Director to one franchise", () => {
    expect(isFranchiseScopedRole("director")).toBe(false);
    for (const role of [
      "franchise",
      "manager",
      "hr",
      "sales_manager",
      "sales",
      "chef",
      "part_time_chef",
    ] as const) {
      expect(isFranchiseScopedRole(role)).toBe(true);
    }
  });
});
