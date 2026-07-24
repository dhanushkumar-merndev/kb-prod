import { describe, expect, it } from "vitest";

import { getRoleHomePath } from "@/lib/auth/routes";
import type { Role } from "@/lib/constants/roles";
import {
  canAccessRolePath,
  getRoleNavigation,
  ROLE_DISPLAY_NAMES,
  ROLE_NAVIGATION,
} from "@/lib/navigation/role-navigation";

type ExpectedNavigationItem = {
  label: string;
  href: string;
};

const EXPECTED_NAVIGATION = {
  director: [
    { label: "Dashboard", href: "/director/dashboard" },
    { label: "Leads & Calls", href: "/director/leads" },
    { label: "Conversations", href: "/director/conversations" },
    { label: "Bookings", href: "/director/bookings" },
    { label: "Payments", href: "/director/payments" },
    { label: "Sales Team", href: "/director/sales-team" },
    { label: "Chefs & Staff", href: "/director/workforce" },
    { label: "Attendance", href: "/director/attendance" },
    { label: "Expenses", href: "/director/expenses" },
    { label: "Team & Access", href: "/director/team" },
    { label: "Assign Work", href: "/director/tasks" },
    { label: "HR Overview", href: "/director/hr" },
    { label: "Leave", href: "/director/leave" },
    { label: "Meetings", href: "/director/meetings" },
    { label: "Payroll", href: "/director/payroll" },
    { label: "Business Reports", href: "/director/reports" },
    { label: "Login Activity", href: "/director/sessions" },
    { label: "Integrations", href: "/director/integrations" },
    { label: "Import & Sync", href: "/director/import-sync" },
  ],
  manager: [
    { label: "Operations Dashboard", href: "/manager/dashboard" },
    { label: "Leads & Calls", href: "/manager/leads" },
    { label: "Conversations", href: "/manager/conversations" },
    { label: "Bookings", href: "/manager/bookings" },
    { label: "Payment Verification", href: "/manager/payments" },
    { label: "Chefs & Staff", href: "/manager/workforce" },
    { label: "Attendance", href: "/manager/attendance" },
    { label: "Expenses", href: "/manager/expenses" },
    { label: "Team & Access", href: "/manager/team" },
    { label: "Assign Work", href: "/manager/tasks" },
    { label: "Leave", href: "/manager/leave" },
    { label: "Meetings", href: "/manager/meetings" },
    { label: "Login Activity", href: "/manager/sessions" },
  ],
  sales_manager: [
    { label: "Dashboard", href: "/sales-manager/dashboard" },
    { label: "Team Leads", href: "/sales-manager/leads" },
    { label: "Lead Assignment", href: "/sales-manager/assignment" },
    { label: "Follow-ups", href: "/sales-manager/follow-ups" },
    { label: "Calls", href: "/sales-manager/calls" },
    { label: "Conversations", href: "/sales-manager/conversations" },
    { label: "Team Bookings", href: "/sales-manager/bookings" },
    { label: "Payment Verification", href: "/sales-manager/payments" },
    { label: "Sales Team", href: "/sales-manager/team" },
    { label: "Performance", href: "/sales-manager/performance" },
    { label: "My Expenses", href: "/sales-manager/expenses" },
    { label: "Assign Work", href: "/sales-manager/tasks" },
    { label: "Leave", href: "/sales-manager/leave" },
    { label: "Meetings", href: "/sales-manager/meetings" },
  ],
  sales: [
    { label: "Dashboard", href: "/sales/dashboard" },
    { label: "My Leads", href: "/sales/leads" },
    { label: "Follow-ups", href: "/sales/follow-ups" },
    { label: "Calls", href: "/sales/calls" },
    { label: "Conversations", href: "/sales/conversations" },
    { label: "My Bookings", href: "/sales/bookings" },
    { label: "Payments", href: "/sales/payments" },
    { label: "My Performance", href: "/sales/performance" },
    { label: "My Expenses", href: "/sales/expenses" },
    { label: "My Tasks", href: "/sales/tasks" },
    { label: "Leave", href: "/sales/leave" },
    { label: "Meetings", href: "/sales/meetings" },
  ],
  hr: [
    { label: "HR Dashboard", href: "/hr/dashboard" },
    { label: "Chefs & Part-time Chefs", href: "/hr/chefs" },
    { label: "Temporary Workers", href: "/hr/temporary-workers" },
    { label: "Booking Assignment", href: "/hr/booking-assignment" },
    { label: "Attendance Approval", href: "/hr/attendance" },
    { label: "Expense Claims", href: "/hr/expenses" },
    { label: "Leave Requests", href: "/hr/leave" },
    { label: "Employee Records", href: "/hr/employee-records" },
    { label: "Meetings", href: "/hr/meetings" },
    { label: "Payroll", href: "/hr/payroll" },
  ],
  chef: [
    { label: "Dashboard", href: "/chef/dashboard" },
    { label: "My Jobs", href: "/chef/jobs" },
    { label: "Attendance", href: "/chef/attendance" },
    { label: "My Expenses", href: "/chef/expenses" },
    { label: "My Earnings", href: "/chef/earnings" },
    { label: "My Tasks", href: "/chef/tasks" },
    { label: "Leave", href: "/chef/leave" },
    { label: "Meetings", href: "/chef/meetings" },
  ],
  part_time_chef: [
    { label: "Dashboard", href: "/part-time-chef/dashboard" },
    { label: "My Jobs", href: "/part-time-chef/jobs" },
    { label: "Attendance", href: "/part-time-chef/attendance" },
    { label: "My Expenses", href: "/part-time-chef/expenses" },
    { label: "My Earnings", href: "/part-time-chef/earnings" },
    { label: "My Tasks", href: "/part-time-chef/tasks" },
    { label: "Leave", href: "/part-time-chef/leave" },
    { label: "Meetings", href: "/part-time-chef/meetings" },
  ],
} satisfies Record<Role, ExpectedNavigationItem[]>;

const ROLE_NAMESPACES = {
  director: "director",
  manager: "manager",
  sales_manager: "sales-manager",
  sales: "sales",
  hr: "hr",
  chef: "chef",
  part_time_chef: "part-time-chef",
} satisfies Record<Role, string>;

const ROLES = Object.keys(EXPECTED_NAVIGATION) as Role[];

describe("role navigation", () => {
  it("defines the requested display label for every CRM role", () => {
    expect(ROLE_DISPLAY_NAMES).toEqual({
      director: "Director",
      manager: "Manager",
      sales_manager: "Sales Manager",
      sales: "Sales Executive",
      hr: "HR",
      chef: "Chef",
      part_time_chef: "Part-time Chef",
    });
  });

  it.each(ROLES)("defines every permitted module for %s in contract order", (role) => {
    const configuredItems = ROLE_NAVIGATION[role].map(({ label, href }) => ({ label, href }));
    const resolvedItems = getRoleNavigation(role).map(({ label, href }) => ({ label, href }));

    expect(configuredItems).toEqual(EXPECTED_NAVIGATION[role]);
    expect(resolvedItems).toEqual(EXPECTED_NAVIGATION[role]);
  });

  it.each(ROLES)("keeps every %s navigation item inside its role namespace", (role) => {
    const namespace = ROLE_NAMESPACES[role];
    const hrefs = getRoleNavigation(role).map(({ href }) => href);

    expect(hrefs).toHaveLength(new Set(hrefs).size);
    expect(hrefs.every((href) => href.startsWith(`/${namespace}/`))).toBe(true);
  });

  it.each(ROLES)("uses the first navigation item as the %s login destination", (role) => {
    const firstItem = getRoleNavigation(role)[0];

    expect(firstItem?.href).toBe(getRoleHomePath(role));
    expect(firstItem?.href).toBe(`/${ROLE_NAMESPACES[role]}/dashboard`);
  });
});

describe("role route access", () => {
  it.each(ROLES)("allows %s to open every page in its own navigation", (role) => {
    for (const { href } of getRoleNavigation(role)) {
      expect(canAccessRolePath(role, href)).toBe(true);
    }
  });

  it.each(ROLES)("denies %s access to every other role namespace", (role) => {
    for (const otherRole of ROLES) {
      if (otherRole === role) {
        continue;
      }

      expect(canAccessRolePath(role, getRoleHomePath(otherRole))).toBe(false);
    }
  });

  it("allows nested pages in the own namespace and denies nested cross-role pages", () => {
    expect(canAccessRolePath("sales", "/sales/leads/lead-id")).toBe(true);
    expect(canAccessRolePath("sales", "/sales-manager/leads/lead-id")).toBe(false);
    expect(canAccessRolePath("chef", "/chef/jobs/booking-id")).toBe(true);
    expect(canAccessRolePath("chef", "/part-time-chef/jobs/booking-id")).toBe(false);
  });

  it("allows shared non-role paths without treating them as role escalation", () => {
    expect(canAccessRolePath("chef", "/account")).toBe(true);
    expect(canAccessRolePath("director", "/login")).toBe(true);
  });
});
