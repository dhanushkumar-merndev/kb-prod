import type { ReactNode } from "react";

import { LogoutButton } from "@/features/auth/logout-button";
import { loadNotifications, NotificationCenter } from "@/features/notifications";
import { loadSessionSummary, SessionSummary } from "@/features/session-controls";
import { requireRoleSession } from "@/lib/auth/require-role-session";
import type { Role } from "@/lib/constants/roles";
import { getRoleNavigation } from "@/lib/navigation/role-navigation";

import { AppShell } from "./app-shell";

interface RoleWorkspaceLayoutProps {
  allowedRoles: readonly Role[];
  children: ReactNode;
}

const BREAK_ELIGIBLE_ROLES: readonly Role[] = ["sales", "chef", "part_time_chef"];

export async function RoleWorkspaceLayout({ allowedRoles, children }: RoleWorkspaceLayoutProps) {
  const session = await requireRoleSession(allowedRoles);
  const [notifications, sessionSummary] = await Promise.all([
    loadNotifications(session.userId),
    loadSessionSummary(session.userId),
  ]);

  return (
    <AppShell
      logoutControl={<LogoutButton />}
      navigation={getRoleNavigation(session.profile.role)}
      notificationControl={
        <NotificationCenter
          notifications={notifications}
          organizationId={session.profile.organization_id}
          profileId={session.userId}
        />
      }
      sessionControl={
        <SessionSummary
          data={sessionSummary}
          showBreakControls={BREAK_ELIGIBLE_ROLES.includes(session.profile.role)}
        />
      }
      profile={{
        fullName: session.profile.full_name,
        phone: session.profile.phone_e164,
        role: session.profile.role,
      }}
    >
      {children}
    </AppShell>
  );
}
