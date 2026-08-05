import type { Role } from "@/lib/constants/roles";

export type NavigationIcon =
  | "dashboard"
  | "leads"
  | "conversations"
  | "bookings"
  | "payments"
  | "team"
  | "attendance"
  | "expenses"
  | "tasks"
  | "leave"
  | "meetings"
  | "payroll"
  | "reports"
  | "activity"
  | "integrations";

export type ModuleResource =
  | "dashboard"
  | "leads"
  | "follow_ups"
  | "calls"
  | "conversations"
  | "bookings"
  | "workforce_bookings"
  | "payments"
  | "sales_profiles"
  | "workforce_profiles"
  | "all_profiles"
  | "attendance"
  | "expenses"
  | "leave"
  | "tasks"
  | "meetings"
  | "payroll"
  | "reports"
  | "login_sessions"
  | "integrations"
  | "sync_runs"
  | "temporary_workers"
  | "franchises";

export interface RoleNavigationItem {
  label: string;
  href: string;
  description: string;
  icon: NavigationIcon;
  resource: ModuleResource;
}

function item(
  namespace: string,
  slug: string,
  label: string,
  description: string,
  icon: NavigationIcon,
  resource: ModuleResource,
): RoleNavigationItem {
  return {
    label,
    href: `/${namespace}/${slug}`,
    description,
    icon,
    resource,
  };
}

export const ROLE_NAMESPACES: Record<Role, string> = {
  director: "director",
  franchise: "franchise",
  manager: "manager",
  hr: "hr",
  sales_manager: "sales-manager",
  sales: "sales",
  chef: "chef",
  part_time_chef: "part-time-chef",
};

export const ROLE_DISPLAY_NAMES: Record<Role, string> = {
  director: "Director",
  franchise: "Franchise Owner",
  manager: "Manager",
  hr: "HR",
  sales_manager: "Sales Manager",
  sales: "Sales Executive",
  chef: "Chef",
  part_time_chef: "Part-time Chef",
};

const director = "director";
const franchise = "franchise";
const manager = "manager";
const hr = "hr";
const salesManager = "sales-manager";
const sales = "sales";
const chef = "chef";
const partTimeChef = "part-time-chef";

export const ROLE_NAVIGATION: Record<Role, readonly RoleNavigationItem[]> = {
  director: [
    item(
      director,
      "dashboard",
      "Dashboard",
      "Company-wide operations and performance.",
      "dashboard",
      "dashboard",
    ),
    item(
      director,
      "leads",
      "Leads & Calls",
      "All incoming leads and call activity.",
      "leads",
      "leads",
    ),
    item(
      director,
      "conversations",
      "Conversations",
      "Customer message activity.",
      "conversations",
      "conversations",
    ),
    item(director, "bookings", "Bookings", "Every customer booking.", "bookings", "bookings"),
    item(
      director,
      "payments",
      "Payments",
      "Submitted and verified payments.",
      "payments",
      "payments",
    ),
    item(
      director,
      "sales-team",
      "Sales Team",
      "Sales leadership and executives.",
      "team",
      "sales_profiles",
    ),
    item(
      director,
      "workforce",
      "Chefs & Staff",
      "Kitchen and workforce directory.",
      "team",
      "workforce_profiles",
    ),
    item(
      director,
      "attendance",
      "Attendance",
      "Live and completed shifts.",
      "attendance",
      "attendance",
    ),
    item(
      director,
      "expenses",
      "Expenses",
      "Claims across the organization.",
      "expenses",
      "expenses",
    ),
    item(
      director,
      "team",
      "Team & Access",
      "Staff access and account status.",
      "team",
      "all_profiles",
    ),
    item(
      director,
      "franchises",
      "Franchises",
      "Franchise units and their owners.",
      "team",
      "franchises",
    ),
    item(director, "tasks", "Assign Work", "Operational tasks and ownership.", "tasks", "tasks"),
    item(
      director,
      "hr",
      "HR Overview",
      "Workforce bookings and records.",
      "team",
      "workforce_bookings",
    ),
    item(director, "leave", "Leave", "Organization leave requests.", "leave", "leave"),
    item(director, "meetings", "Meetings", "Scheduled team meetings.", "meetings", "meetings"),
    item(director, "payroll", "Payroll", "Payroll periods and earnings.", "payroll", "payroll"),
    item(
      director,
      "reports",
      "Business Reports",
      "Live booking and revenue totals.",
      "reports",
      "reports",
    ),
    item(
      director,
      "sessions",
      "Login Activity",
      "Staff application sessions.",
      "activity",
      "login_sessions",
    ),
    item(
      director,
      "integrations",
      "Integrations",
      "Provider connection health.",
      "integrations",
      "integrations",
    ),
    item(
      director,
      "import-sync",
      "Import & Sync",
      "Provider synchronization runs.",
      "integrations",
      "sync_runs",
    ),
  ],
  franchise: [
    item(
      franchise,
      "dashboard",
      "Dashboard",
      "Your franchise operations and performance.",
      "dashboard",
      "dashboard",
    ),
    item(
      franchise,
      "leads",
      "Leads & Calls",
      "Leads and call activity in your franchise.",
      "leads",
      "leads",
    ),
    item(
      franchise,
      "conversations",
      "Conversations",
      "Customer message activity.",
      "conversations",
      "conversations",
    ),
    item(franchise, "bookings", "Bookings", "Every booking in your franchise.", "bookings", "bookings"),
    item(
      franchise,
      "payments",
      "Payments",
      "Submitted and verified payments.",
      "payments",
      "payments",
    ),
    item(
      franchise,
      "sales-team",
      "Sales Team",
      "Your sales leadership and executives.",
      "team",
      "sales_profiles",
    ),
    item(
      franchise,
      "workforce",
      "Chefs & Staff",
      "Your kitchen and workforce directory.",
      "team",
      "workforce_profiles",
    ),
    item(
      franchise,
      "attendance",
      "Attendance",
      "Live and completed shifts.",
      "attendance",
      "attendance",
    ),
    item(
      franchise,
      "expenses",
      "Expenses",
      "Claims across your franchise.",
      "expenses",
      "expenses",
    ),
    item(
      franchise,
      "team",
      "Team & Access",
      "Franchise staff access and account status.",
      "team",
      "all_profiles",
    ),
    item(franchise, "tasks", "Assign Work", "Operational tasks and ownership.", "tasks", "tasks"),
    item(
      franchise,
      "hr",
      "HR Overview",
      "Workforce bookings and records.",
      "team",
      "workforce_bookings",
    ),
    item(franchise, "leave", "Leave", "Franchise leave requests.", "leave", "leave"),
    item(franchise, "meetings", "Meetings", "Scheduled team meetings.", "meetings", "meetings"),
    item(franchise, "payroll", "Payroll", "Payroll periods and earnings.", "payroll", "payroll"),
    item(
      franchise,
      "reports",
      "Business Reports",
      "Live booking and revenue totals.",
      "reports",
      "reports",
    ),
    item(
      franchise,
      "sessions",
      "Login Activity",
      "Franchise staff application sessions.",
      "activity",
      "login_sessions",
    ),
  ],
  manager: [
    item(
      manager,
      "dashboard",
      "Operations Dashboard",
      "Cross-team operational health.",
      "dashboard",
      "dashboard",
    ),
    item(manager, "leads", "Leads & Calls", "Sales pipeline and call activity.", "leads", "leads"),
    item(
      manager,
      "conversations",
      "Conversations",
      "Customer message activity.",
      "conversations",
      "conversations",
    ),
    item(manager, "bookings", "Bookings", "Current and upcoming bookings.", "bookings", "bookings"),
    item(
      manager,
      "payments",
      "Payment Verification",
      "Payment proofs requiring review.",
      "payments",
      "payments",
    ),
    item(
      manager,
      "workforce",
      "Chefs & Staff",
      "Kitchen and workforce directory.",
      "team",
      "workforce_profiles",
    ),
    item(
      manager,
      "attendance",
      "Attendance",
      "Live and completed shifts.",
      "attendance",
      "attendance",
    ),
    item(
      manager,
      "expenses",
      "Expenses",
      "Expense claims and approval status.",
      "expenses",
      "expenses",
    ),
    item(
      manager,
      "team",
      "Team & Access",
      "Staff access and account status.",
      "team",
      "all_profiles",
    ),
    item(manager, "tasks", "Assign Work", "Operational tasks and ownership.", "tasks", "tasks"),
    item(manager, "leave", "Leave", "Team leave requests.", "leave", "leave"),
    item(manager, "meetings", "Meetings", "Scheduled team meetings.", "meetings", "meetings"),
    item(
      manager,
      "sessions",
      "Login Activity",
      "Staff application sessions.",
      "activity",
      "login_sessions",
    ),
  ],
  hr: [
    item(
      hr,
      "dashboard",
      "HR Dashboard",
      "Workforce operations and approvals.",
      "dashboard",
      "dashboard",
    ),
    item(
      hr,
      "chefs",
      "Chefs & Part-time Chefs",
      "Kitchen team directory.",
      "team",
      "workforce_profiles",
    ),
    item(
      hr,
      "temporary-workers",
      "Temporary Workers",
      "Helpers, servers, cleaners and drivers.",
      "team",
      "temporary_workers",
    ),
    item(
      hr,
      "booking-assignment",
      "Booking Assignment",
      "Confirmed work requiring Chef coverage.",
      "bookings",
      "workforce_bookings",
    ),
    item(
      hr,
      "attendance",
      "Attendance Approval",
      "Shift review and payroll eligibility.",
      "attendance",
      "attendance",
    ),
    item(hr, "expenses", "Expense Claims", "Kitchen-side expense review.", "expenses", "expenses"),
    item(hr, "leave", "Leave Requests", "Kitchen-side leave review.", "leave", "leave"),
    item(
      hr,
      "employee-records",
      "Employee Records",
      "Essential workforce records.",
      "team",
      "workforce_profiles",
    ),
    item(hr, "meetings", "Meetings", "Workforce meetings.", "meetings", "meetings"),
    item(hr, "payroll", "Payroll", "Workforce payroll records.", "payroll", "payroll"),
  ],
  sales_manager: [
    item(
      salesManager,
      "dashboard",
      "Dashboard",
      "Sales pipeline and team performance.",
      "dashboard",
      "dashboard",
    ),
    item(salesManager, "leads", "Team Leads", "All sales-team leads.", "leads", "leads"),
    item(
      salesManager,
      "assignment",
      "Lead Assignment",
      "Lead ownership and queue.",
      "leads",
      "leads",
    ),
    item(
      salesManager,
      "follow-ups",
      "Follow-ups",
      "Open and overdue follow-ups.",
      "leads",
      "follow_ups",
    ),
    item(salesManager, "calls", "Calls", "Superfone call activity.", "activity", "calls"),
    item(
      salesManager,
      "conversations",
      "Conversations",
      "Customer message activity.",
      "conversations",
      "conversations",
    ),
    item(
      salesManager,
      "bookings",
      "Team Bookings",
      "Bookings sold by the team.",
      "bookings",
      "bookings",
    ),
    item(
      salesManager,
      "payments",
      "Payment Verification",
      "Payment proofs requiring review.",
      "payments",
      "payments",
    ),
    item(
      salesManager,
      "team",
      "Sales Team",
      "Sales Executive directory.",
      "team",
      "sales_profiles",
    ),
    item(
      salesManager,
      "performance",
      "Performance",
      "Live pipeline and conversion totals.",
      "reports",
      "reports",
    ),
    item(salesManager, "expenses", "My Expenses", "Your submitted claims.", "expenses", "expenses"),
    item(salesManager, "tasks", "Assign Work", "Sales tasks and ownership.", "tasks", "tasks"),
    item(salesManager, "leave", "Leave", "Your and team leave requests.", "leave", "leave"),
    item(salesManager, "meetings", "Meetings", "Sales meetings.", "meetings", "meetings"),
  ],
  sales: [
    item(
      sales,
      "dashboard",
      "Dashboard",
      "Your pipeline and follow-ups.",
      "dashboard",
      "dashboard",
    ),
    item(sales, "leads", "My Leads", "Leads assigned to you.", "leads", "leads"),
    item(sales, "follow-ups", "Follow-ups", "Your open follow-ups.", "leads", "follow_ups"),
    item(sales, "calls", "Calls", "Your call activity.", "activity", "calls"),
    item(
      sales,
      "conversations",
      "Conversations",
      "Assigned customer conversations.",
      "conversations",
      "conversations",
    ),
    item(sales, "bookings", "My Bookings", "Bookings sold by you.", "bookings", "bookings"),
    item(sales, "payments", "Payments", "Payment proofs and collection.", "payments", "payments"),
    item(sales, "performance", "My Performance", "Your live sales totals.", "reports", "reports"),
    item(sales, "expenses", "My Expenses", "Your submitted claims.", "expenses", "expenses"),
    item(sales, "tasks", "My Tasks", "Work assigned to you.", "tasks", "tasks"),
    item(sales, "leave", "Leave", "Your leave requests.", "leave", "leave"),
    item(sales, "meetings", "Meetings", "Meetings you are attending.", "meetings", "meetings"),
  ],
  chef: [
    item(
      chef,
      "dashboard",
      "Dashboard",
      "Your assigned work and shift status.",
      "dashboard",
      "dashboard",
    ),
    item(chef, "jobs", "My Jobs", "Bookings assigned to you.", "bookings", "workforce_bookings"),
    item(
      chef,
      "attendance",
      "Attendance",
      "Your current and previous shifts.",
      "attendance",
      "attendance",
    ),
    item(chef, "expenses", "My Expenses", "Your submitted claims.", "expenses", "expenses"),
    item(chef, "earnings", "My Earnings", "Your payroll records.", "payroll", "payroll"),
    item(chef, "tasks", "My Tasks", "Work assigned to you.", "tasks", "tasks"),
    item(chef, "leave", "Leave", "Your leave requests.", "leave", "leave"),
    item(chef, "meetings", "Meetings", "Meetings you are attending.", "meetings", "meetings"),
  ],
  part_time_chef: [
    item(
      partTimeChef,
      "dashboard",
      "Dashboard",
      "Your assigned work and shift status.",
      "dashboard",
      "dashboard",
    ),
    item(
      partTimeChef,
      "jobs",
      "My Jobs",
      "Bookings assigned to you.",
      "bookings",
      "workforce_bookings",
    ),
    item(
      partTimeChef,
      "attendance",
      "Attendance",
      "Your eligible work shifts.",
      "attendance",
      "attendance",
    ),
    item(partTimeChef, "expenses", "My Expenses", "Your submitted claims.", "expenses", "expenses"),
    item(partTimeChef, "earnings", "My Earnings", "Your payroll records.", "payroll", "payroll"),
    item(partTimeChef, "tasks", "My Tasks", "Work assigned to you.", "tasks", "tasks"),
    item(partTimeChef, "leave", "Leave", "Your leave requests.", "leave", "leave"),
    item(
      partTimeChef,
      "meetings",
      "Meetings",
      "Meetings you are attending.",
      "meetings",
      "meetings",
    ),
  ],
};

export function getRoleNavigation(role: Role): readonly RoleNavigationItem[] {
  return ROLE_NAVIGATION[role];
}

export function getRoleNavigationItem(role: Role, slug: string): RoleNavigationItem | undefined {
  return ROLE_NAVIGATION[role].find((entry) => entry.href.endsWith(`/${slug}`));
}

export function canAccessRolePath(role: Role, pathname: string): boolean {
  const namespace = pathname.split("/").filter(Boolean)[0];
  const protectedNamespaces = new Set(Object.values(ROLE_NAMESPACES));

  if (!namespace || !protectedNamespaces.has(namespace)) {
    return true;
  }

  return namespace === ROLE_NAMESPACES[role];
}
