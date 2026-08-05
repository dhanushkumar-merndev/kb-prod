import type { Role } from "@/lib/constants/roles";

export type OperationalDomain =
  "organization" | "integration" | "sales" | "workforce" | "payroll" | "audit" | "own";

// A Franchise Owner mirrors the Director inside its own franchise. Which
// franchise that is comes from the database, never from these tables.
const ACCOUNT_CREATION_SCOPE: Record<Role, readonly Role[]> = {
  director: ["franchise", "manager", "hr", "sales_manager", "sales", "chef", "part_time_chef"],
  franchise: ["manager", "hr", "sales_manager", "sales", "chef", "part_time_chef"],
  manager: ["hr", "sales_manager", "sales", "chef", "part_time_chef"],
  hr: ["chef", "part_time_chef"],
  sales_manager: ["sales"],
  sales: [],
  chef: [],
  part_time_chef: [],
};

const ACCOUNT_STATUS_SCOPE: Record<Role, readonly Role[]> = {
  director: ["franchise", "manager", "hr", "sales_manager", "sales", "chef", "part_time_chef"],
  franchise: ["manager", "hr", "sales_manager", "sales", "chef", "part_time_chef"],
  manager: ["hr", "sales_manager", "sales", "chef", "part_time_chef"],
  hr: ["chef", "part_time_chef"],
  sales_manager: ["sales"],
  sales: [],
  chef: [],
  part_time_chef: [],
};

const DOMAIN_ACCESS: Record<Role, readonly OperationalDomain[]> = {
  director: ["organization", "integration", "sales", "workforce", "payroll", "audit", "own"],
  franchise: ["sales", "workforce", "payroll", "audit", "own"],
  manager: ["sales", "workforce", "payroll", "audit", "own"],
  hr: ["workforce", "payroll", "audit", "own"],
  sales_manager: ["sales", "audit", "own"],
  sales: ["sales", "own"],
  chef: ["workforce", "own"],
  part_time_chef: ["workforce", "own"],
};

export function canCreateRole(actorRole: Role, targetRole: Role): boolean {
  return ACCOUNT_CREATION_SCOPE[actorRole].includes(targetRole);
}

export function canManageAccountStatus(actorRole: Role, targetRole: Role): boolean {
  return ACCOUNT_STATUS_SCOPE[actorRole].includes(targetRole);
}

export function canAccessDomain(actorRole: Role, domain: OperationalDomain): boolean {
  return DOMAIN_ACCESS[actorRole].includes(domain);
}

export function isSalesRole(role: Role): boolean {
  return role === "sales" || role === "sales_manager";
}

export function isWorkforceRole(role: Role): boolean {
  return role === "hr" || role === "chef" || role === "part_time_chef";
}

export function isChefRole(role: Role): boolean {
  return role === "chef" || role === "part_time_chef";
}

export function isOperationalAdmin(role: Role): boolean {
  return role === "director" || role === "franchise" || role === "manager";
}

export function isSalesScopeAdmin(role: Role): boolean {
  return isOperationalAdmin(role) || role === "sales_manager";
}

export function isWorkforceScopeAdmin(role: Role): boolean {
  return isOperationalAdmin(role) || role === "hr";
}

/** Only the Director owns the organization: franchises, integrations, secrets. */
export function isOrganizationAdmin(role: Role): boolean {
  return role === "director";
}

/** Roles pinned to exactly one franchise. The Director is organization-wide. */
export function isFranchiseScopedRole(role: Role): boolean {
  return role !== "director";
}
