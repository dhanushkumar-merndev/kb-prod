import { describe, expect, it } from "vitest";

import { getRoleHomePath, isRoleRouteAllowed } from "@/lib/auth/routes";

describe("role-based auth redirects", () => {
  it.each([
    ["director" as const, "/director/dashboard"],
    ["manager" as const, "/manager/dashboard"],
    ["hr" as const, "/hr/dashboard"],
    ["sales_manager" as const, "/sales-manager/dashboard"],
    ["sales" as const, "/sales/dashboard"],
    ["chef" as const, "/chef/dashboard"],
    ["part_time_chef" as const, "/part-time-chef/dashboard"],
  ])("redirects %s to its dashboard", (role, expected) => {
    expect(getRoleHomePath(role)).toBe(expected);
  });

  it("rejects another role namespace while allowing shared paths", () => {
    expect(isRoleRouteAllowed("/director/dashboard", "sales")).toBe(false);
    expect(isRoleRouteAllowed("/sales-manager/conversations", "sales_manager")).toBe(true);
    expect(isRoleRouteAllowed("/part-time-chef/jobs", "part_time_chef")).toBe(true);
    expect(isRoleRouteAllowed("/chef/jobs", "part_time_chef")).toBe(false);
    expect(isRoleRouteAllowed("/account", "chef")).toBe(true);
  });
});
