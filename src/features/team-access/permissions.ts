import type { Role } from "@/lib/constants/roles";

export const CREATABLE_ROLES: Record<Role, readonly Role[]> = {
  director: ["manager", "hr", "sales_manager", "sales", "chef", "part_time_chef"],
  manager: ["hr", "sales_manager", "sales", "chef", "part_time_chef"],
  hr: ["chef", "part_time_chef"],
  sales_manager: ["sales"],
  sales: [],
  chef: [],
  part_time_chef: [],
};
