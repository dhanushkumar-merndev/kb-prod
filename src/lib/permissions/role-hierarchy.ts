import type { Role } from "@/lib/constants/roles";

export type OperationalDomain =
  "organization" | "integration" | "sales" | "workforce" | "payroll" | "audit" | "own";

const ACCOUNT_CREATION_SCOPE: Record<Role, readonly Role[]> = {
  director: ["manager", "hr", "sales_manager", "sales", "chef", "part_time_chef"],
  manager: ["hr", "sales_manager", "sales", "chef", "part_time_chef"],
  hr: ["chef", "part_time_chef"],
  sales_manager: ["sales"],
  sales: [],
  chef: [],
  part_time_chef: [],
};

const ACCOUNT_STATUS_SCOPE: Record<Role, readonly Role[]> = {
  director: ["manager", "hr", "sales_manager", "sales", "chef", "part_time_chef"],
  manager: ["hr", "sales_manager", "sales", "chef", "part_time_chef"],
  hr: ["chef", "part_time_chef"],
  sales_manager: ["sales"],
  sales: [],
  chef: [],
  part_time_chef: [],
};

const DOMAIN_ACCESS: Record<Role, readonly OperationalDomain[]> = {
  director: ["organization", "integration", "sales", "workforce", "payroll", "audit", "own"],
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
  return role === "director" || role === "manager";
}

export function isSalesScopeAdmin(role: Role): boolean {
  return role === "director" || role === "manager" || role === "sales_manager";
}

export function isWorkforceScopeAdmin(role: Role): boolean {
  return role === "director" || role === "manager" || role === "hr";
}
