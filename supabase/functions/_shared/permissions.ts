import { AppError } from "./errors.ts";
import type { ProfileRecord, ProfileRole } from "./types.ts";

const CREATE_ROLE_PERMISSIONS: Partial<Record<ProfileRole, readonly ProfileRole[]>> = {
  director: ["franchise", "manager", "hr", "sales_manager", "sales", "chef", "part_time_chef"],
  franchise: ["manager", "hr", "sales_manager", "sales", "chef", "part_time_chef"],
  manager: ["hr", "sales_manager", "sales", "chef", "part_time_chef"],
  hr: ["chef", "part_time_chef"],
  sales_manager: ["sales"],
};

const MANAGE_ROLE_PERMISSIONS: Partial<Record<ProfileRole, readonly ProfileRole[]>> = {
  director: ["franchise", "manager", "hr", "sales_manager", "sales", "chef", "part_time_chef"],
  franchise: ["manager", "hr", "sales_manager", "sales", "chef", "part_time_chef"],
  manager: ["hr", "sales_manager", "sales", "chef", "part_time_chef"],
  hr: ["chef", "part_time_chef"],
  sales_manager: ["sales"],
};

const REPLACE_ROLE_PERMISSIONS: Partial<Record<ProfileRole, readonly ProfileRole[]>> = {
  director: ["franchise", "manager", "hr", "sales_manager"],
  franchise: ["manager", "hr", "sales_manager"],
  manager: ["hr", "sales_manager"],
};

function roleAllowed(
  permissions: Partial<Record<ProfileRole, readonly ProfileRole[]>>,
  actorRole: ProfileRole,
  targetRole: ProfileRole,
): boolean {
  return permissions[actorRole]?.includes(targetRole) ?? false;
}

export function assertCanCreateRole(actorRole: ProfileRole, targetRole: ProfileRole): void {
  if (!roleAllowed(CREATE_ROLE_PERMISSIONS, actorRole, targetRole)) {
    throw new AppError("PERMISSION_DENIED");
  }
}

export function assertCanManageRole(actorRole: ProfileRole, targetRole: ProfileRole): void {
  if (!roleAllowed(MANAGE_ROLE_PERMISSIONS, actorRole, targetRole)) {
    throw new AppError("PERMISSION_DENIED");
  }
}

export function assertCanReplaceRole(actorRole: ProfileRole, targetRole: ProfileRole): void {
  if (!roleAllowed(REPLACE_ROLE_PERMISSIONS, actorRole, targetRole)) {
    throw new AppError("PERMISSION_DENIED");
  }
}

export function assertSeparateProfiles(actor: ProfileRecord, target: ProfileRecord): void {
  if (actor.id === target.id) {
    throw new AppError("PERMISSION_DENIED");
  }
}

export function assertSameOrganization(actor: ProfileRecord, target: ProfileRecord): void {
  if (actor.organization_id !== target.organization_id) {
    // Deliberately indistinguishable from a missing row across tenants.
    throw new AppError("NOT_FOUND");
  }
}

/**
 * A franchise-scoped actor may only touch profiles inside its own franchise.
 * The database repeats this check, so a bug here cannot widen access.
 */
export function assertSameFranchise(actor: ProfileRecord, target: ProfileRecord): void {
  if (actor.franchise_id === null) {
    return;
  }

  if (actor.franchise_id !== target.franchise_id) {
    // Deliberately indistinguishable from a missing row across franchises.
    throw new AppError("NOT_FOUND");
  }
}

export function assertStoragePathOrganization(
  storagePath: string | undefined,
  organizationId: string,
): void {
  if (!storagePath) {
    return;
  }

  const firstSegment = storagePath.split("/")[0];
  if (firstSegment !== organizationId) {
    throw new AppError("PERMISSION_DENIED");
  }
}
