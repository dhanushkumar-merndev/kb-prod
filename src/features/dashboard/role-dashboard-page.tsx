import { Suspense } from "react";

import { RealtimeRefresh } from "@/components/realtime/realtime-refresh";
import { loadDashboardDataForSession } from "./dashboard-data";
import { DashboardLoading, DashboardResultView } from "./role-dashboard";
import { PayrollPanel } from "@/features/payroll";
import { requireRoleSession } from "@/lib/auth/require-role-session";
import type { Role } from "@/lib/constants/roles";
import { createServerSupabaseClient } from "@/lib/supabase/server";

interface RoleDashboardPageProps {
  role: Role;
}

async function RoleDashboardPageContent({ role }: RoleDashboardPageProps) {
  const session = await requireRoleSession([role]);
  const supabase = await createServerSupabaseClient();
  const result = await loadDashboardDataForSession(supabase, session.profile);

  return (
    <>
      <RealtimeRefresh
        channelName={`${role}-dashboard`}
        organizationId={session.profile.organization_id}
        tables={[
          "profiles",
          "leads",
          "follow_ups",
          "conversations",
          "bookings",
          "booking_assignments",
          "booking_payments",
          "attendance_shifts",
          "expenses",
          "leave_requests",
          "tasks",
        ]}
      />
      <DashboardResultView result={result} />
      {role === "manager" ? (
        <section id="payroll-review">
          <PayrollPanel />
        </section>
      ) : null}
    </>
  );
}

export function RoleDashboardPage({ role }: RoleDashboardPageProps) {
  return (
    <Suspense fallback={<DashboardLoading />}>
      <RoleDashboardPageContent role={role} />
    </Suspense>
  );
}
