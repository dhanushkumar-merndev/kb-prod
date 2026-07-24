import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type {
  DashboardActivityItem,
  DashboardChartItem,
  DashboardLoadResult,
  DashboardMetric,
  DashboardMetricTone,
  DashboardNextBooking,
  DashboardPendingAction,
} from "./types";
import { requireActiveSession } from "@/lib/auth/require-session";
import type { AuthContext } from "@/lib/auth/types";
import type { Role } from "@/lib/constants/roles";
import { createServerSupabaseClient } from "@/lib/supabase/server";

interface CountResponse {
  count: number | null;
  error: { message: string } | null;
}

interface MetricDefinition {
  id: string;
  label: string;
  description: string;
  tone: DashboardMetricTone;
  load: () => Promise<CountResponse>;
}

interface RoleDashboardCopy {
  title: string;
  subtitle: string;
  chartTitle: string;
  chartDescription: string;
  chartMetricIds: string[];
}

const WORKFORCE_BOOKING_STATUSES = [
  "pending",
  "confirmed",
  "chef_assigned",
  "preparing",
  "service_completed",
  "fully_completed",
  "cancelled",
] as const;

const workforceBookingRowsSchema = z.array(
  z.object({
    booking_code: z.string(),
    event_type: z.string(),
    event_date: z.string(),
    reporting_time: z.string().nullable(),
    venue: z.string(),
    guest_count: z.number().int().nonnegative(),
    service_status: z.enum(WORKFORCE_BOOKING_STATUSES),
  }),
);

const recentNotificationRowsSchema = z.array(
  z.object({
    id: z.string().uuid(),
    title: z.string(),
    body: z.string().nullable(),
    read_at: z.string().nullable(),
    created_at: z.string(),
  }),
);

const dashboardLeadCountsSchema = z.object({
  total_count: z.coerce.number().int().nonnegative(),
  new_count: z.coerce.number().int().nonnegative(),
  unassigned_count: z.coerce.number().int().nonnegative(),
  qualified_count: z.coerce.number().int().nonnegative(),
  booking_payment_pending_count: z.coerce.number().int().nonnegative(),
});

const dashboardMetricCountsSchema = z.record(z.string(), z.coerce.number().int().nonnegative());

const ROLE_COPY: Record<Role, RoleDashboardCopy> = {
  director: {
    title: "Director dashboard",
    subtitle: "Live organization-wide activity and approvals.",
    chartTitle: "Operational workload",
    chartDescription: "Current work and approval queues visible to the Director.",
    chartMetricIds: [
      "leads",
      "upcoming_bookings",
      "pending_payments",
      "pending_attendance",
      "working_now",
    ],
  },
  manager: {
    title: "Operations dashboard",
    subtitle: "Today’s events, staffing, approvals, and overdue work.",
    chartTitle: "Operations requiring attention",
    chartDescription: "Live operational queues visible to the Manager.",
    chartMetricIds: [
      "today_events",
      "pending_payments",
      "pending_attendance",
      "pending_expenses",
      "overdue_tasks",
    ],
  },
  hr: {
    title: "HR dashboard",
    subtitle: "Live workforce availability, attendance, and review queues.",
    chartTitle: "Workforce workload",
    chartDescription: "Current attendance and workforce review queues.",
    chartMetricIds: [
      "working_now",
      "pending_attendance",
      "pending_leave",
      "pending_expenses",
      "temporary_workers_today",
    ],
  },
  sales_manager: {
    title: "Sales Manager dashboard",
    subtitle: "Live team pipeline, assignments, and payment verification.",
    chartTitle: "Sales queue",
    chartDescription: "Current lead and approval workload across the sales team.",
    chartMetricIds: [
      "new_leads",
      "unassigned_leads",
      "qualified_leads",
      "overdue_followups",
      "pending_payments",
    ],
  },
  sales: {
    title: "Sales Executive dashboard",
    subtitle: "Your assigned pipeline, follow-ups, and bookings.",
    chartTitle: "My pipeline",
    chartDescription: "Current lead and booking stages assigned to you.",
    chartMetricIds: [
      "new_leads",
      "qualified_leads",
      "booking_payment_pending",
      "confirmed_bookings",
      "overdue_followups",
    ],
  },
  chef: {
    title: "Chef dashboard",
    subtitle: "Your assigned jobs, attendance, and expense status.",
    chartTitle: "My job status",
    chartDescription: "Assigned jobs in the current two-year operating window.",
    chartMetricIds: ["pending_jobs", "preparing_jobs", "completed_jobs"],
  },
  part_time_chef: {
    title: "Part-time Chef dashboard",
    subtitle: "Your booking-wise jobs, attendance, and expense status.",
    chartTitle: "My job status",
    chartDescription: "Assigned jobs in the current two-year operating window.",
    chartMetricIds: ["pending_jobs", "preparing_jobs", "completed_jobs"],
  },
};

class DashboardQueryError extends Error {
  constructor(
    public readonly metricId: string,
    public readonly safeCode = "QUERY_FAILED",
  ) {
    super("A dashboard query failed.");
    this.name = "DashboardQueryError";
  }
}

function indiaDate(offsetDays = 0): string {
  const instant = new Date(Date.now() + offsetDays * 86_400_000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    throw new DashboardQueryError("current_date");
  }

  return `${year}-${month}-${day}`;
}

function indiaDayBoundary(date: string, boundary: "start" | "end"): string {
  return boundary === "start" ? `${date}T00:00:00.000+05:30` : `${date}T23:59:59.999+05:30`;
}

async function resolveMetrics(definitions: MetricDefinition[]): Promise<DashboardMetric[]> {
  return Promise.all(
    definitions.map(async ({ load, ...definition }) => {
      let response: CountResponse;

      try {
        response = await load();
      } catch {
        throw new DashboardQueryError(definition.id);
      }

      if (response.error) {
        throw new DashboardQueryError(definition.id);
      }

      return {
        ...definition,
        value: response.count ?? 0,
      };
    }),
  );
}

function countLoader(query: PromiseLike<CountResponse>): () => Promise<CountResponse> {
  return async () => {
    const response = await query;

    return {
      count: response.count,
      error: response.error,
    };
  };
}

async function loadDashboardLeadCounts(
  supabase: SupabaseClient,
): Promise<z.infer<typeof dashboardLeadCountsSchema>> {
  const { data, error } = await supabase.rpc("get_dashboard_lead_counts");

  if (error) {
    throw new DashboardQueryError("lead_counts", error.code || "RPC_FAILED");
  }

  const value = Array.isArray(data) ? data[0] : data;
  const parsed = dashboardLeadCountsSchema.safeParse(value);

  if (!parsed.success) {
    throw new DashboardQueryError("lead_counts", "INVALID_RESPONSE");
  }

  return parsed.data;
}

function aggregatedMetric(
  counts: z.infer<typeof dashboardMetricCountsSchema>,
  id: string,
  label: string,
  description: string,
  tone: DashboardMetricTone,
): DashboardMetric {
  const value = counts[id];

  if (value === undefined) {
    throw new DashboardQueryError(id, "INVALID_RESPONSE");
  }

  return { id, label, description, tone, value };
}

async function loadAggregatedMetricsForRole(
  supabase: SupabaseClient,
  profile: AuthContext,
  today: string,
  now: string,
): Promise<DashboardMetric[] | null> {
  if (profile.role === "chef" || profile.role === "part_time_chef") {
    return null;
  }

  const { data, error } = await supabase.rpc("get_dashboard_metric_counts", {
    p_today: today,
    p_now: now,
  });

  if (error) {
    throw new DashboardQueryError("dashboard_metrics", error.code || "RPC_FAILED");
  }

  const parsed = dashboardMetricCountsSchema.safeParse(data);
  if (!parsed.success) {
    throw new DashboardQueryError("dashboard_metrics", "INVALID_RESPONSE");
  }

  const counts = parsed.data;
  const metric = (id: string, label: string, description: string, tone: DashboardMetricTone) =>
    aggregatedMetric(counts, id, label, description, tone);

  switch (profile.role) {
    case "director":
      return [
        metric("leads", "Leads received", "All active lead records", "navy"),
        metric(
          "upcoming_bookings",
          "Upcoming bookings",
          "Non-cancelled events from today",
          "saffron",
        ),
        metric("active_staff", "Active staff", "Active team profiles", "mint"),
        metric("working_now", "Working now", "Open workforce shifts", "mint"),
        metric("pending_payments", "Payment proofs", "Awaiting verification", "haldi"),
        metric("pending_attendance", "Attendance approvals", "Shifts awaiting review", "chilli"),
      ];
    case "manager":
      return [
        metric("today_events", "Today’s events", "Non-cancelled bookings today", "navy"),
        metric("active_staff", "Active staff", "Active team profiles", "mint"),
        metric("pending_payments", "Payment verification", "Proofs awaiting review", "haldi"),
        metric("pending_attendance", "Attendance approvals", "Shifts awaiting review", "saffron"),
        metric("pending_expenses", "Expense reviews", "Pending or verified claims", "haldi"),
        metric("overdue_tasks", "Overdue tasks", "Open work past its due time", "chilli"),
        metric(
          "payroll_review",
          "Payroll review",
          "Prepared payroll periods awaiting review",
          "haldi",
        ),
      ];
    case "hr":
      return [
        metric("active_chefs", "Active Chefs", "Regular Chefs with active access", "navy"),
        metric(
          "active_part_time_chefs",
          "Part-time Chefs",
          "Part-time Chefs with active access",
          "saffron",
        ),
        metric("temporary_workers_today", "Temporary workers", "Scheduled for today", "slate"),
        metric("working_now", "Working now", "Open workforce shifts", "mint"),
        metric("pending_attendance", "Attendance approvals", "Shifts awaiting review", "saffron"),
        metric("pending_leave", "Leave requests", "Workforce leave awaiting review", "haldi"),
        metric("pending_expenses", "Expense claims", "Workforce claims awaiting review", "chilli"),
      ];
    case "sales_manager":
      return [
        metric("new_leads", "New leads", "New leads in the team queue", "navy"),
        metric("unassigned_leads", "Unassigned leads", "Leads needing an owner", "saffron"),
        metric("qualified_leads", "Qualified leads", "Team leads ready to progress", "mint"),
        metric("overdue_followups", "Overdue follow-ups", "Open follow-ups past due", "chilli"),
        metric("pending_payments", "Payment verification", "Proofs awaiting review", "haldi"),
        metric("open_conversations", "Open conversations", "Open or pending team threads", "slate"),
      ];
    case "sales":
      return [
        metric("new_leads", "New assigned leads", "New leads assigned to you", "navy"),
        metric("followups_today", "Follow-ups today", "Open follow-ups due today", "saffron"),
        metric(
          "overdue_followups",
          "Overdue follow-ups",
          "Your open follow-ups past due",
          "chilli",
        ),
        metric("qualified_leads", "Qualified leads", "Your leads ready to progress", "mint"),
        metric(
          "booking_payment_pending",
          "Booking payments",
          "Your leads awaiting booking payment",
          "haldi",
        ),
        metric("confirmed_bookings", "Confirmed bookings", "Your upcoming confirmed work", "mint"),
        metric("pending_payments", "Proofs pending", "Your proofs awaiting verification", "slate"),
      ];
  }
}

async function directorMetrics(
  supabase: SupabaseClient,
  profile: AuthContext,
  today: string,
): Promise<DashboardMetric[]> {
  const organizationId = profile.organization_id;
  const [leadCounts, remainingMetrics] = await Promise.all([
    loadDashboardLeadCounts(supabase),
    resolveMetrics([
      {
        id: "upcoming_bookings",
        label: "Upcoming bookings",
        description: "Non-cancelled events from today",
        tone: "saffron",
        load: countLoader(
          supabase
            .from("bookings")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", organizationId)
            .gte("event_date", today)
            .neq("service_status", "cancelled")
            .is("deleted_at", null),
        ),
      },
      {
        id: "active_staff",
        label: "Active staff",
        description: "Active team profiles",
        tone: "mint",
        load: countLoader(
          supabase
            .from("profiles")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", organizationId)
            .eq("account_status", "active")
            .is("deleted_at", null),
        ),
      },
      {
        id: "working_now",
        label: "Working now",
        description: "Open workforce shifts",
        tone: "mint",
        load: countLoader(
          supabase
            .from("attendance_shifts")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", organizationId)
            .eq("status", "working"),
        ),
      },
      {
        id: "pending_payments",
        label: "Payment proofs",
        description: "Awaiting verification",
        tone: "haldi",
        load: countLoader(
          supabase
            .from("booking_payments")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", organizationId)
            .eq("verification_status", "pending"),
        ),
      },
      {
        id: "pending_attendance",
        label: "Attendance approvals",
        description: "Shifts awaiting review",
        tone: "chilli",
        load: countLoader(
          supabase
            .from("attendance_shifts")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", organizationId)
            .eq("status", "pending_approval"),
        ),
      },
    ]),
  ]);

  return [
    {
      id: "leads",
      label: "Leads received",
      description: "All active lead records",
      tone: "navy",
      value: leadCounts.total_count,
    },
    ...remainingMetrics,
  ];
}

function managerMetrics(
  supabase: SupabaseClient,
  profile: AuthContext,
  today: string,
  now: string,
): Promise<DashboardMetric[]> {
  const organizationId = profile.organization_id;

  return resolveMetrics([
    {
      id: "today_events",
      label: "Today’s events",
      description: "Non-cancelled bookings today",
      tone: "navy",
      load: countLoader(
        supabase
          .from("bookings")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId)
          .eq("event_date", today)
          .neq("service_status", "cancelled")
          .is("deleted_at", null),
      ),
    },
    {
      id: "active_staff",
      label: "Active staff",
      description: "Active team profiles",
      tone: "mint",
      load: countLoader(
        supabase
          .from("profiles")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId)
          .eq("account_status", "active")
          .is("deleted_at", null),
      ),
    },
    {
      id: "pending_payments",
      label: "Payment verification",
      description: "Proofs awaiting review",
      tone: "haldi",
      load: countLoader(
        supabase
          .from("booking_payments")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId)
          .eq("verification_status", "pending"),
      ),
    },
    {
      id: "pending_attendance",
      label: "Attendance approvals",
      description: "Shifts awaiting review",
      tone: "saffron",
      load: countLoader(
        supabase
          .from("attendance_shifts")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId)
          .eq("status", "pending_approval"),
      ),
    },
    {
      id: "pending_expenses",
      label: "Expense reviews",
      description: "Pending or verified claims",
      tone: "haldi",
      load: countLoader(
        supabase
          .from("expenses")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId)
          .in("status", ["pending", "verified"]),
      ),
    },
    {
      id: "overdue_tasks",
      label: "Overdue tasks",
      description: "Open work past its due time",
      tone: "chilli",
      load: countLoader(
        supabase
          .from("tasks")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId)
          .in("status", ["open", "in_progress"])
          .lt("due_at", now),
      ),
    },
    {
      id: "payroll_review",
      label: "Payroll review",
      description: "Prepared payroll periods awaiting review",
      tone: "haldi",
      load: countLoader(
        supabase
          .from("payroll_periods")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId)
          .eq("status", "prepared"),
      ),
    },
  ]);
}

function hrMetrics(
  supabase: SupabaseClient,
  profile: AuthContext,
  today: string,
): Promise<DashboardMetric[]> {
  const organizationId = profile.organization_id;

  return resolveMetrics([
    {
      id: "active_chefs",
      label: "Active Chefs",
      description: "Regular Chefs with active access",
      tone: "navy",
      load: countLoader(
        supabase
          .from("profiles")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId)
          .eq("role", "chef")
          .eq("account_status", "active")
          .is("deleted_at", null),
      ),
    },
    {
      id: "active_part_time_chefs",
      label: "Part-time Chefs",
      description: "Part-time Chefs with active access",
      tone: "saffron",
      load: countLoader(
        supabase
          .from("profiles")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId)
          .eq("role", "part_time_chef")
          .eq("account_status", "active")
          .is("deleted_at", null),
      ),
    },
    {
      id: "temporary_workers_today",
      label: "Temporary workers",
      description: "Scheduled for today",
      tone: "slate",
      load: countLoader(
        supabase
          .from("temporary_worker_assignments")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId)
          .eq("work_date", today),
      ),
    },
    {
      id: "working_now",
      label: "Working now",
      description: "Open workforce shifts",
      tone: "mint",
      load: countLoader(
        supabase
          .from("attendance_shifts")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId)
          .eq("status", "working"),
      ),
    },
    {
      id: "pending_attendance",
      label: "Attendance approvals",
      description: "Shifts awaiting review",
      tone: "saffron",
      load: countLoader(
        supabase
          .from("attendance_shifts")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId)
          .eq("status", "pending_approval"),
      ),
    },
    {
      id: "pending_leave",
      label: "Leave requests",
      description: "Workforce leave awaiting review",
      tone: "haldi",
      load: countLoader(
        supabase
          .from("leave_requests")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId)
          .eq("status", "pending"),
      ),
    },
    {
      id: "pending_expenses",
      label: "Expense claims",
      description: "Workforce claims awaiting review",
      tone: "chilli",
      load: countLoader(
        supabase
          .from("expenses")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId)
          .eq("status", "pending"),
      ),
    },
  ]);
}

async function salesManagerMetrics(
  supabase: SupabaseClient,
  profile: AuthContext,
  today: string,
): Promise<DashboardMetric[]> {
  const organizationId = profile.organization_id;
  const startOfToday = indiaDayBoundary(today, "start");
  const [leadCounts, remainingMetrics] = await Promise.all([
    loadDashboardLeadCounts(supabase),
    resolveMetrics([
      {
        id: "overdue_followups",
        label: "Overdue follow-ups",
        description: "Open follow-ups past due",
        tone: "chilli",
        load: countLoader(
          supabase
            .from("follow_ups")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", organizationId)
            .in("status", ["open", "overdue"])
            .lt("due_at", startOfToday),
        ),
      },
      {
        id: "pending_payments",
        label: "Payment verification",
        description: "Proofs awaiting review",
        tone: "haldi",
        load: countLoader(
          supabase
            .from("booking_payments")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", organizationId)
            .eq("verification_status", "pending"),
        ),
      },
      {
        id: "open_conversations",
        label: "Open conversations",
        description: "Open or pending team threads",
        tone: "slate",
        load: countLoader(
          supabase
            .from("conversations")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", organizationId)
            .in("status", ["open", "pending"]),
        ),
      },
    ]),
  ]);

  return [
    {
      id: "new_leads",
      label: "New leads",
      description: "New leads in the team queue",
      tone: "navy",
      value: leadCounts.new_count,
    },
    {
      id: "unassigned_leads",
      label: "Unassigned leads",
      description: "Leads needing an owner",
      tone: "saffron",
      value: leadCounts.unassigned_count,
    },
    {
      id: "qualified_leads",
      label: "Qualified leads",
      description: "Team leads ready to progress",
      tone: "mint",
      value: leadCounts.qualified_count,
    },
    ...remainingMetrics,
  ];
}

async function salesMetrics(
  supabase: SupabaseClient,
  profile: AuthContext,
  today: string,
): Promise<DashboardMetric[]> {
  const organizationId = profile.organization_id;
  const profileId = profile.id;
  const startOfToday = indiaDayBoundary(today, "start");
  const endOfToday = indiaDayBoundary(today, "end");
  const [leadCounts, remainingMetrics] = await Promise.all([
    loadDashboardLeadCounts(supabase),
    resolveMetrics([
      {
        id: "followups_today",
        label: "Follow-ups today",
        description: "Open follow-ups due today",
        tone: "saffron",
        load: countLoader(
          supabase
            .from("follow_ups")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", organizationId)
            .eq("assigned_profile_id", profileId)
            .in("status", ["open", "overdue"])
            .gte("due_at", startOfToday)
            .lte("due_at", endOfToday),
        ),
      },
      {
        id: "overdue_followups",
        label: "Overdue follow-ups",
        description: "Your open follow-ups past due",
        tone: "chilli",
        load: countLoader(
          supabase
            .from("follow_ups")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", organizationId)
            .eq("assigned_profile_id", profileId)
            .in("status", ["open", "overdue"])
            .lt("due_at", startOfToday),
        ),
      },
      {
        id: "confirmed_bookings",
        label: "Confirmed bookings",
        description: "Your upcoming confirmed work",
        tone: "mint",
        load: countLoader(
          supabase
            .from("bookings")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", organizationId)
            .eq("sold_by_profile_id", profileId)
            .gte("event_date", today)
            .in("service_status", ["confirmed", "chef_assigned", "preparing"])
            .is("deleted_at", null),
        ),
      },
      {
        id: "pending_payments",
        label: "Proofs pending",
        description: "Your proofs awaiting verification",
        tone: "slate",
        load: countLoader(
          supabase
            .from("booking_payments")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", organizationId)
            .eq("submitted_by_profile_id", profileId)
            .eq("verification_status", "pending"),
        ),
      },
    ]),
  ]);

  return [
    {
      id: "new_leads",
      label: "New assigned leads",
      description: "New leads assigned to you",
      tone: "navy",
      value: leadCounts.new_count,
    },
    {
      id: "qualified_leads",
      label: "Qualified leads",
      description: "Your leads ready to progress",
      tone: "mint",
      value: leadCounts.qualified_count,
    },
    {
      id: "booking_payment_pending",
      label: "Booking payments",
      description: "Your leads awaiting booking payment",
      tone: "haldi",
      value: leadCounts.booking_payment_pending_count,
    },
    ...remainingMetrics,
  ];
}

async function workforceMetrics(
  supabase: SupabaseClient,
  profile: AuthContext,
): Promise<DashboardMetric[]> {
  const organizationId = profile.organization_id;
  const { data, error } = await supabase.rpc("get_workforce_bookings", {
    p_from_date: indiaDate(-365),
    p_to_date: indiaDate(365),
    p_service_status: null,
  });

  if (error) {
    throw new DashboardQueryError("workforce_bookings");
  }

  const parsedRows = workforceBookingRowsSchema.safeParse(data ?? []);

  if (!parsedRows.success) {
    throw new DashboardQueryError("workforce_bookings");
  }

  const rows = parsedRows.data;
  const pendingJobs = rows.filter((row) =>
    ["pending", "confirmed", "chef_assigned"].includes(row.service_status),
  ).length;
  const preparingJobs = rows.filter((row) => row.service_status === "preparing").length;
  const completedJobs = rows.filter((row) =>
    ["service_completed", "fully_completed"].includes(row.service_status),
  ).length;
  const supplementaryMetrics = await resolveMetrics([
    {
      id: "total_assigned",
      label: "Total assigned",
      description: "All active job assignments",
      tone: "navy",
      load: countLoader(
        supabase
          .from("booking_assignments")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId)
          .eq("chef_profile_id", profile.id)
          .is("unassigned_at", null),
      ),
    },
    {
      id: "working_now",
      label: "Attendance",
      description: "Shifts currently in progress",
      tone: "mint",
      load: countLoader(
        supabase
          .from("attendance_shifts")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId)
          .eq("profile_id", profile.id)
          .eq("status", "working"),
      ),
    },
    {
      id: "pending_attendance",
      label: "Attendance review",
      description: "Your shifts awaiting HR approval",
      tone: "haldi",
      load: countLoader(
        supabase
          .from("attendance_shifts")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId)
          .eq("profile_id", profile.id)
          .eq("status", "pending_approval"),
      ),
    },
    {
      id: "pending_expenses",
      label: "Expense claims",
      description: "Your claims awaiting a decision",
      tone: "chilli",
      load: countLoader(
        supabase
          .from("expenses")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId)
          .eq("submitted_by_profile_id", profile.id)
          .in("status", ["pending", "verified"]),
      ),
    },
  ]);

  return [
    {
      id: "pending_jobs",
      label: "Pending jobs",
      description: "Assigned jobs not yet started",
      tone: "saffron",
      value: pendingJobs,
    },
    {
      id: "preparing_jobs",
      label: "Preparing jobs",
      description: "Services currently preparing",
      tone: "haldi",
      value: preparingJobs,
    },
    {
      id: "completed_jobs",
      label: "Completed jobs",
      description: "Completed in the last 12 months",
      tone: "mint",
      value: completedJobs,
    },
    ...supplementaryMetrics,
  ];
}

const ACTION_ROUTES: Record<Role, Partial<Record<string, string>>> = {
  director: {
    pending_payments: "/director/payments",
    pending_attendance: "/director/attendance",
    working_now: "/director/attendance",
    upcoming_bookings: "/director/bookings",
  },
  manager: {
    pending_payments: "/manager/payments",
    pending_attendance: "/manager/attendance",
    pending_expenses: "/manager/expenses",
    overdue_tasks: "/manager/tasks",
    today_events: "/manager/bookings",
    payroll_review: "/manager/dashboard#payroll-review",
  },
  hr: {
    pending_attendance: "/hr/attendance",
    pending_leave: "/hr/leave",
    pending_expenses: "/hr/expenses",
    temporary_workers_today: "/hr/temporary-workers",
    working_now: "/hr/attendance",
  },
  sales_manager: {
    unassigned_leads: "/sales-manager/assignment",
    overdue_followups: "/sales-manager/follow-ups",
    pending_payments: "/sales-manager/payments",
    open_conversations: "/sales-manager/conversations",
    qualified_leads: "/sales-manager/leads",
  },
  sales: {
    followups_today: "/sales/follow-ups",
    overdue_followups: "/sales/follow-ups",
    booking_payment_pending: "/sales/payments",
    pending_payments: "/sales/payments",
    qualified_leads: "/sales/leads",
  },
  chef: {
    pending_jobs: "/chef/jobs",
    preparing_jobs: "/chef/jobs",
    working_now: "/chef/attendance",
    pending_attendance: "/chef/attendance",
    pending_expenses: "/chef/expenses",
  },
  part_time_chef: {
    pending_jobs: "/part-time-chef/jobs",
    preparing_jobs: "/part-time-chef/jobs",
    working_now: "/part-time-chef/attendance",
    pending_attendance: "/part-time-chef/attendance",
    pending_expenses: "/part-time-chef/expenses",
  },
};

async function loadRecentActivity(
  supabase: SupabaseClient,
  profile: AuthContext,
): Promise<DashboardActivityItem[]> {
  const { data, error } = await supabase
    .from("notifications")
    .select("id,title,body,read_at,created_at")
    .eq("organization_id", profile.organization_id)
    .eq("recipient_profile_id", profile.id)
    .order("created_at", { ascending: false })
    .limit(6);

  if (error) {
    throw new DashboardQueryError("recent_activity");
  }

  const parsed = recentNotificationRowsSchema.safeParse(data ?? []);

  if (!parsed.success) {
    throw new DashboardQueryError("recent_activity");
  }

  return parsed.data.map((row) => ({
    id: row.id,
    title: row.title,
    body: row.body,
    occurredAt: row.created_at,
    unread: row.read_at === null,
  }));
}

function pendingActionsForRole(role: Role, metrics: DashboardMetric[]): DashboardPendingAction[] {
  const routes = ACTION_ROUTES[role];

  return metrics.flatMap((metric) => {
    const href = routes[metric.id];

    if (!href || metric.value === 0) {
      return [];
    }

    return [
      {
        id: metric.id,
        label: metric.label,
        description: metric.description,
        count: metric.value,
        href,
        tone: metric.tone,
      },
    ];
  });
}

async function loadNextWorkforceBooking(
  supabase: SupabaseClient,
  profile: AuthContext,
): Promise<DashboardNextBooking | null> {
  if (!["chef", "part_time_chef"].includes(profile.role)) {
    return null;
  }

  const { data, error } = await supabase.rpc("get_workforce_bookings", {
    p_from_date: indiaDate(),
    p_to_date: indiaDate(365),
    p_service_status: null,
  });

  if (error) {
    throw new DashboardQueryError("next_booking");
  }

  const parsed = workforceBookingRowsSchema.safeParse(data ?? []);

  if (!parsed.success) {
    throw new DashboardQueryError("next_booking");
  }

  const next = parsed.data.find((row) => row.service_status !== "cancelled");

  return next
    ? {
        bookingCode: next.booking_code,
        eventType: next.event_type,
        eventDate: next.event_date,
        reportingTime: next.reporting_time,
        venue: next.venue,
        guestCount: next.guest_count,
      }
    : null;
}

function metricsForRole(
  supabase: SupabaseClient,
  profile: AuthContext,
  today: string,
  now: string,
): Promise<DashboardMetric[]> {
  return loadAggregatedMetricsForRole(supabase, profile, today, now).then((aggregated) => {
    if (aggregated) {
      return aggregated;
    }

    switch (profile.role) {
      case "director":
        return directorMetrics(supabase, profile, today);
      case "manager":
        return managerMetrics(supabase, profile, today, now);
      case "hr":
        return hrMetrics(supabase, profile, today);
      case "sales_manager":
        return salesManagerMetrics(supabase, profile, today);
      case "sales":
        return salesMetrics(supabase, profile, today);
      case "chef":
      case "part_time_chef":
        return workforceMetrics(supabase, profile);
    }
  });
}

function chartItems(metrics: DashboardMetric[], metricIds: string[]): DashboardChartItem[] {
  const metricsById = new Map(metrics.map((metric) => [metric.id, metric]));

  return metricIds.flatMap((id) => {
    const metric = metricsById.get(id);

    if (!metric) {
      return [];
    }

    return [
      {
        label: metric.label,
        value: metric.value,
        tone: metric.tone,
      },
    ];
  });
}

export async function loadDashboardDataForSession(
  supabase: SupabaseClient,
  profile: AuthContext,
): Promise<DashboardLoadResult> {
  const copy = ROLE_COPY[profile.role];

  try {
    const [metrics, recentActivity, nextBooking] = await Promise.all([
      metricsForRole(supabase, profile, indiaDate(), new Date().toISOString()),
      loadRecentActivity(supabase, profile),
      loadNextWorkforceBooking(supabase, profile),
    ]);

    return {
      ok: true,
      data: {
        profileName: profile.full_name,
        role: profile.role,
        title: copy.title,
        subtitle: copy.subtitle,
        metrics,
        chart: {
          title: copy.chartTitle,
          description: copy.chartDescription,
          items: chartItems(metrics, copy.chartMetricIds),
        },
        recentActivity,
        pendingActions: pendingActionsForRole(profile.role, metrics),
        nextBooking,
        updatedAt: new Date().toISOString(),
      },
    };
  } catch (error) {
    const failedMetric =
      error instanceof DashboardQueryError ? error.metricId : "unknown_dashboard_metric";
    const safeCode = error instanceof DashboardQueryError ? error.safeCode : "UNEXPECTED_ERROR";

    console.error(
      `[dashboard] RLS-scoped dashboard query failed: role=${profile.role} metric=${failedMetric} code=${safeCode}`,
    );

    return {
      ok: false,
      profileName: profile.full_name,
      role: profile.role,
      title: copy.title,
      message: "Live dashboard data could not be loaded. Please refresh and try again.",
    };
  }
}

export async function loadCurrentDashboardData(): Promise<DashboardLoadResult> {
  const session = await requireActiveSession();
  const supabase = await createServerSupabaseClient();

  return loadDashboardDataForSession(supabase, session.profile);
}
