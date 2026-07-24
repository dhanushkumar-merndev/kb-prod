import { ROLE_HOME_ROUTES } from "@/lib/constants/roles";
import { ROLE_NAMESPACES } from "@/lib/navigation/role-navigation";

import type { ProfileRole } from "./types";

const PROTECTED_ROLE_NAMESPACES = new Set(Object.values(ROLE_NAMESPACES));

export function getRoleHomePath(role: ProfileRole): string {
  return ROLE_HOME_ROUTES[role];
}

export function getRoleNamespace(role: ProfileRole): string {
  return getRoleHomePath(role).split("/")[1] ?? "";
}

export function isRoleRouteAllowed(pathname: string, role: ProfileRole): boolean {
  const namespace = pathname.split("/").filter(Boolean)[0];

  if (!namespace || !PROTECTED_ROLE_NAMESPACES.has(namespace)) {
    return true;
  }

  return namespace === getRoleNamespace(role);
}
