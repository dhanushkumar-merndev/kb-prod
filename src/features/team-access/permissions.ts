import type { Role } from "@/lib/constants/roles";

export const CREATABLE_ROLES: Record<Role, readonly Role[]> = {
  director: ["franchise", "manager", "hr", "sales_manager", "sales", "chef", "part_time_chef"],
  franchise: ["manager", "hr", "sales_manager", "sales", "chef", "part_time_chef"],
  manager: ["hr", "sales_manager", "sales", "chef", "part_time_chef"],
  hr: ["chef", "part_time_chef"],
  sales_manager: ["sales"],
  sales: [],
  chef: [],
  part_time_chef: [],
};

/**
 * Only the Director picks which franchise a new account joins. Everyone else
 * creates inside their own franchise, so the server ignores any value they send.
 */
export function requiresFranchiseSelection(actorRole: Role): boolean {
  return actorRole === "director";
}
