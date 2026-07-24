export const ROLES = [
  "director",
  "manager",
  "hr",
  "sales_manager",
  "sales",
  "chef",
  "part_time_chef",
] as const;

export type Role = (typeof ROLES)[number];

export const ACCOUNT_STATUSES = [
  "active",
  "inactive",
  "blocked",
  "payment_pending",
  "left_organization",
] as const;

export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  director: "Director",
  manager: "Manager",
  hr: "HR",
  sales_manager: "Sales Manager",
  sales: "Sales Executive",
  chef: "Chef",
  part_time_chef: "Part-time Chef",
};

export const ACCOUNT_STATUS_LABELS: Record<AccountStatus, string> = {
  active: "Active",
  inactive: "Inactive",
  blocked: "Blocked",
  payment_pending: "Payment pending",
  left_organization: "Left organization",
};

export const ROLE_HOME_ROUTES: Record<Role, string> = {
  director: "/director/dashboard",
  manager: "/manager/dashboard",
  hr: "/hr/dashboard",
  sales_manager: "/sales-manager/dashboard",
  sales: "/sales/dashboard",
  chef: "/chef/dashboard",
  part_time_chef: "/part-time-chef/dashboard",
};

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function isAccountStatus(value: unknown): value is AccountStatus {
  return typeof value === "string" && (ACCOUNT_STATUSES as readonly string[]).includes(value);
}
