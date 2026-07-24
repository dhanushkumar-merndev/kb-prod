import { redirect } from "next/navigation";

import type { Role } from "@/lib/constants/roles";

import { requireActiveSession } from "./require-session";
import { getRoleHomePath } from "./routes";
import type { AuthenticatedSession } from "./types";

export async function requireRoleSession(
  allowedRoles: readonly Role[],
): Promise<AuthenticatedSession> {
  const session = await requireActiveSession();

  if (!allowedRoles.includes(session.profile.role)) {
    redirect(getRoleHomePath(session.profile.role));
  }

  return session;
}
