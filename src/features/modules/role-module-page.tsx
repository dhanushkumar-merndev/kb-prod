import { AlertTriangle, DatabaseZap } from "lucide-react";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { RealtimeRefresh } from "@/components/realtime/realtime-refresh";
import { BookingCrudPanel } from "@/features/bookings";
import { ConversationPanel } from "@/features/conversations";
import {
  LeadCrudPanel,
  OwnExpenseCrudPanel,
  OwnLeaveCrudPanel,
  TaskCrudPanel,
} from "@/features/core-crud";
import { EmployeeRecordsPanel } from "@/features/employee-records";
import { IntegrationPanel } from "@/features/integrations";
import { MeetingCrudPanel, TemporaryWorkerCrudPanel } from "@/features/secondary-crud";
import { SalesOperationsPanel } from "@/features/sales-operations";
import { PaymentPanel } from "@/features/payments";
import { PayrollPanel } from "@/features/payroll";
import { ExpenseReviewPanel, LeaveReviewPanel } from "@/features/reviews";
import { TeamAccessPanel } from "@/features/team-access";
import { WorkforcePanel } from "@/features/workforce";
import { AttendanceApprovalPanel, BookingAssignmentPanel } from "@/features/workforce-management";
import { requireRoleSession } from "@/lib/auth/require-role-session";
import type { Role } from "@/lib/constants/roles";
import { getRoleNavigationItem } from "@/lib/navigation/role-navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { loadModuleData } from "./module-data";
import { ModuleTable } from "./module-table";
import { RefreshButton } from "./refresh-button";
import styles from "./workspace-module.module.css";

interface RoleModulePageProps {
  role: Role;
  slug: string;
  bookingPage?: number | undefined;
  bookingSearch?: string | undefined;
  leadPage?: number | undefined;
  leadSearch?: string | undefined;
  teamPage?: number | undefined;
  teamSearch?: string | undefined;
}

const REALTIME_TABLES: Partial<
  Record<
    Exclude<ReturnType<typeof getRoleNavigationItem>, undefined>["resource"],
    readonly string[]
  >
> = {
  leads: ["leads", "lead_activities", "lead_assignment_history"],
  follow_ups: ["follow_ups"],
  calls: ["superfone_calls"],
  conversations: ["conversations", "messages", "conversation_reads"],
  bookings: ["bookings", "booking_assignments", "booking_payments", "invoices", "email_outbox"],
  workforce_bookings: ["bookings", "booking_assignments"],
  payments: ["booking_payments", "bookings"],
  sales_profiles: ["profiles"],
  workforce_profiles: ["profiles"],
  all_profiles: ["profiles"],
  attendance: ["attendance_shifts"],
  expenses: ["expenses"],
  leave: ["leave_requests"],
  tasks: ["tasks"],
  meetings: ["meetings", "meeting_attendees"],
  temporary_workers: ["temporary_workers", "temporary_worker_assignments"],
  integrations: ["integration_connections", "email_outbox", "invoices"],
};

export async function RoleModulePage({
  bookingPage,
  bookingSearch,
  leadPage,
  leadSearch,
  role,
  slug,
  teamPage,
  teamSearch,
}: RoleModulePageProps) {
  const session = await requireRoleSession([role]);
  const navigationItem = getRoleNavigationItem(role, slug);

  if (!navigationItem || navigationItem.resource === "dashboard") {
    notFound();
  }

  let workingPanel: ReactNode = null;
  let showLiveTable = true;

  if (navigationItem.resource === "leads") {
    workingPanel =
      role === "sales_manager" && slug === "assignment" ? (
        <SalesOperationsPanel mode="assignment" />
      ) : (
        <>
          <LeadCrudPanel page={leadPage} search={leadSearch} />
          <SalesOperationsPanel
            mode={role === "director" || role === "manager" ? "overview" : "activity"}
          />
        </>
      );
    showLiveTable = false;
  } else if (navigationItem.resource === "follow_ups") {
    workingPanel = <SalesOperationsPanel mode="follow_ups" />;
    showLiveTable = false;
  } else if (navigationItem.resource === "calls") {
    workingPanel = <SalesOperationsPanel mode="calls" />;
    showLiveTable = false;
  } else if (navigationItem.resource === "conversations") {
    workingPanel = <ConversationPanel />;
    showLiveTable = false;
  } else if (navigationItem.resource === "tasks") {
    workingPanel = <TaskCrudPanel />;
    showLiveTable = false;
  } else if (
    navigationItem.resource === "expenses" &&
    ["sales_manager", "sales", "chef", "part_time_chef"].includes(role)
  ) {
    workingPanel = <OwnExpenseCrudPanel />;
    showLiveTable = false;
  } else if (
    navigationItem.resource === "expenses" &&
    ["director", "manager", "hr"].includes(role)
  ) {
    workingPanel = <ExpenseReviewPanel />;
    showLiveTable = false;
  } else if (
    navigationItem.resource === "leave" &&
    ["sales", "chef", "part_time_chef"].includes(role)
  ) {
    workingPanel = <OwnLeaveCrudPanel />;
    showLiveTable = false;
  } else if (navigationItem.resource === "leave" && role === "sales_manager") {
    workingPanel = (
      <>
        <OwnLeaveCrudPanel />
        <LeaveReviewPanel />
      </>
    );
    showLiveTable = false;
  } else if (navigationItem.resource === "leave" && ["director", "manager", "hr"].includes(role)) {
    workingPanel = <LeaveReviewPanel />;
    showLiveTable = false;
  } else if (
    navigationItem.resource === "attendance" &&
    ["chef", "part_time_chef"].includes(role)
  ) {
    workingPanel = <WorkforcePanel mode="attendance" />;
    showLiveTable = false;
  } else if (
    navigationItem.resource === "workforce_bookings" &&
    ["chef", "part_time_chef"].includes(role)
  ) {
    workingPanel = <WorkforcePanel mode="jobs" />;
    showLiveTable = false;
  } else if (navigationItem.resource === "meetings") {
    workingPanel = <MeetingCrudPanel />;
    showLiveTable = false;
  } else if (navigationItem.resource === "temporary_workers") {
    workingPanel = <TemporaryWorkerCrudPanel />;
    showLiveTable = false;
  } else if (navigationItem.resource === "bookings") {
    workingPanel = <BookingCrudPanel page={bookingPage} search={bookingSearch} />;
    showLiveTable = false;
  } else if (navigationItem.resource === "integrations") {
    workingPanel = <IntegrationPanel />;
    showLiveTable = false;
  } else if (navigationItem.resource === "payments") {
    workingPanel = <PaymentPanel />;
    showLiveTable = false;
  } else if (navigationItem.resource === "payroll") {
    workingPanel = <PayrollPanel />;
    showLiveTable = false;
  } else if (navigationItem.resource === "workforce_bookings" && role === "hr") {
    workingPanel = <BookingAssignmentPanel />;
    showLiveTable = false;
  } else if (
    navigationItem.resource === "attendance" &&
    ["director", "manager", "hr"].includes(role)
  ) {
    workingPanel = <AttendanceApprovalPanel />;
    showLiveTable = false;
  } else if (
    navigationItem.resource === "workforce_profiles" &&
    (["director", "manager"].includes(role) || (role === "hr" && slug === "employee-records"))
  ) {
    workingPanel = <EmployeeRecordsPanel />;
    showLiveTable = false;
  } else if (
    navigationItem.resource === "all_profiles" ||
    (role === "hr" && navigationItem.resource === "workforce_profiles" && slug === "chefs") ||
    (role === "sales_manager" && navigationItem.resource === "sales_profiles")
  ) {
    workingPanel = <TeamAccessPanel page={teamPage} search={teamSearch} />;
    showLiveTable = false;
  }

  const data = showLiveTable
    ? await loadModuleData(await createServerSupabaseClient(), navigationItem.resource)
    : null;
  const isConversationWorkspace = navigationItem.resource === "conversations";

  return (
    <section className={`${styles.page} ${isConversationWorkspace ? styles.conversationPage : ""}`}>
      <RealtimeRefresh
        channelName={`${role}-${slug}`}
        organizationId={session.profile.organization_id}
        tables={REALTIME_TABLES[navigationItem.resource] ?? []}
      />
      {!isConversationWorkspace ? (
        <header className={styles.pageHeader}>
          <div>
            <span className={styles.eyebrow}>Live workspace</span>
            <h1>{navigationItem.label}</h1>
            <p>{navigationItem.description}</p>
          </div>
          <RefreshButton />
        </header>
      ) : null}

      {workingPanel}

      {data?.error ? (
        <div className={styles.errorState} role="alert">
          <AlertTriangle aria-hidden="true" size={22} />
          <div>
            <strong>Data could not be loaded</strong>
            <p>{data.error}</p>
          </div>
        </div>
      ) : data ? (
        <div className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <span className={styles.recordCount}>{data.rows.length}</span>
              <span>{data.rows.length === 1 ? " record" : " records"}</span>
            </div>
            <span className={styles.liveLabel}>Supabase live data</span>
          </div>

          {data.rows.length > 0 ? (
            <ModuleTable columns={data.columns} rows={data.rows} />
          ) : (
            <div className={styles.emptyState}>
              <DatabaseZap aria-hidden="true" size={30} />
              <strong>No records yet</strong>
              <p>
                There are no records visible to your account. New permitted records will appear
                here.
              </p>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
