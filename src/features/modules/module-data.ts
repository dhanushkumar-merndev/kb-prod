import type { SupabaseClient } from "@supabase/supabase-js";

import type { ModuleResource } from "@/lib/navigation/role-navigation";

export interface ModuleColumn {
  key: string;
  label: string;
  format?: "date" | "datetime" | "money" | "status" | "duration";
}

export interface ModuleData {
  columns: readonly ModuleColumn[];
  rows: readonly Record<string, unknown>[];
  error: string | null;
}

type QueryResult = {
  data: unknown;
  error: { message?: string } | null;
};

function records(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (entry): entry is Record<string, unknown> =>
      typeof entry === "object" && entry !== null && !Array.isArray(entry),
  );
}

function tableResult(
  result: QueryResult,
  columns: readonly ModuleColumn[],
  resourceLabel: string,
): ModuleData {
  if (result.error) {
    return {
      columns,
      rows: [],
      error: `We could not load ${resourceLabel}. Refresh the page and try again.`,
    };
  }

  return {
    columns,
    rows: records(result.data),
    error: null,
  };
}

const leadColumns: readonly ModuleColumn[] = [
  { key: "client_name", label: "Client" },
  { key: "phone_e164", label: "Phone" },
  { key: "status", label: "Status", format: "status" },
  { key: "source", label: "Source" },
  { key: "event_date", label: "Event date", format: "date" },
  { key: "quote_amount", label: "Quote", format: "money" },
  { key: "next_follow_up_at", label: "Next follow-up", format: "datetime" },
];

const bookingColumns: readonly ModuleColumn[] = [
  { key: "booking_code", label: "Booking" },
  { key: "client_name", label: "Client" },
  { key: "event_type", label: "Event" },
  { key: "event_date", label: "Date", format: "date" },
  { key: "venue", label: "Venue" },
  { key: "guest_count", label: "Guests" },
  { key: "service_status", label: "Service", format: "status" },
  { key: "payment_status", label: "Payment", format: "status" },
  { key: "total_value", label: "Value", format: "money" },
];

export async function loadModuleData(
  supabase: SupabaseClient,
  resource: Exclude<ModuleResource, "dashboard">,
): Promise<ModuleData> {
  switch (resource) {
    case "leads": {
      const result = await supabase
        .from("leads")
        .select(
          "id, client_name, phone_e164, status, source, event_date, quote_amount, next_follow_up_at, updated_at",
        )
        .order("updated_at", { ascending: false })
        .limit(100);
      return tableResult(result, leadColumns, "leads");
    }
    case "follow_ups": {
      const result = await supabase
        .from("follow_ups")
        .select("id, lead_id, due_at, status, outcome, completed_at, created_at")
        .order("due_at", { ascending: true })
        .limit(100);
      return tableResult(
        result,
        [
          { key: "due_at", label: "Due", format: "datetime" },
          { key: "status", label: "Status", format: "status" },
          { key: "outcome", label: "Outcome" },
          { key: "completed_at", label: "Completed", format: "datetime" },
        ],
        "follow-ups",
      );
    }
    case "calls": {
      const result = await supabase
        .from("superfone_calls")
        .select(
          "id, direction, from_phone_e164, to_phone_e164, status, started_at, duration_seconds",
        )
        .order("started_at", { ascending: false })
        .limit(100);
      return tableResult(
        result,
        [
          { key: "started_at", label: "Started", format: "datetime" },
          { key: "direction", label: "Direction", format: "status" },
          { key: "from_phone_e164", label: "From" },
          { key: "to_phone_e164", label: "To" },
          { key: "status", label: "Status", format: "status" },
          { key: "duration_seconds", label: "Duration", format: "duration" },
        ],
        "calls",
      );
    }
    case "conversations": {
      const result = await supabase
        .from("conversations")
        .select(
          "id, contact_name, contact_phone_e164, channel, status, last_message_preview, last_message_at",
        )
        .order("last_message_at", { ascending: false, nullsFirst: false })
        .limit(100);
      return tableResult(
        result,
        [
          { key: "contact_name", label: "Contact" },
          { key: "contact_phone_e164", label: "Phone" },
          { key: "channel", label: "Channel", format: "status" },
          { key: "status", label: "Status", format: "status" },
          { key: "last_message_preview", label: "Last message" },
          { key: "last_message_at", label: "Updated", format: "datetime" },
        ],
        "conversations",
      );
    }
    case "bookings": {
      const result = await supabase
        .from("bookings")
        .select(
          "id, booking_code, client_name, event_type, event_date, venue, guest_count, service_status, payment_status, total_value",
        )
        .order("event_date", { ascending: true })
        .limit(100);
      return tableResult(result, bookingColumns, "bookings");
    }
    case "workforce_bookings": {
      const today = new Date();
      const end = new Date(today);
      end.setFullYear(end.getFullYear() + 1);
      const result = await supabase.rpc("get_workforce_bookings", {
        p_from_date: today.toISOString().slice(0, 10),
        p_to_date: end.toISOString().slice(0, 10),
      });
      return tableResult(
        result,
        [
          { key: "booking_code", label: "Booking" },
          { key: "event_type", label: "Event" },
          { key: "event_date", label: "Date", format: "date" },
          { key: "reporting_time", label: "Report at" },
          { key: "venue", label: "Venue" },
          { key: "guest_count", label: "Guests" },
          { key: "service_status", label: "Status", format: "status" },
          { key: "chef_name", label: "Assigned Chef" },
          { key: "agreed_pay_amount", label: "Agreed pay", format: "money" },
        ],
        "workforce bookings",
      );
    }
    case "payments": {
      const result = await supabase
        .from("booking_payments")
        .select(
          "id, booking_id, payment_stage, amount, payment_method, verification_status, paid_at, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(100);
      return tableResult(
        result,
        [
          { key: "payment_stage", label: "Stage", format: "status" },
          { key: "amount", label: "Amount", format: "money" },
          { key: "payment_method", label: "Method" },
          { key: "verification_status", label: "Verification", format: "status" },
          { key: "paid_at", label: "Paid", format: "datetime" },
        ],
        "payments",
      );
    }
    case "sales_profiles":
    case "workforce_profiles":
    case "all_profiles": {
      let query = supabase
        .from("profiles")
        .select("id, full_name, phone_e164, role, account_status, joining_date, last_login_at")
        .order("full_name", { ascending: true })
        .limit(100);

      if (resource === "sales_profiles") {
        query = query.in("role", ["sales_manager", "sales"]);
      } else if (resource === "workforce_profiles") {
        query = query.in("role", ["chef", "part_time_chef"]);
      }

      const result = await query;
      return tableResult(
        result,
        [
          { key: "full_name", label: "Name" },
          { key: "phone_e164", label: "Phone" },
          { key: "role", label: "Role", format: "status" },
          { key: "account_status", label: "Account", format: "status" },
          { key: "joining_date", label: "Joined", format: "date" },
          { key: "last_login_at", label: "Last login", format: "datetime" },
        ],
        "team members",
      );
    }
    case "attendance": {
      const result = await supabase
        .from("attendance_shifts")
        .select(
          "id, profile_id, temporary_worker_id, booking_id, shift_date, started_at, ended_at, status, overtime_minutes, payroll_eligible",
        )
        .order("shift_date", { ascending: false })
        .limit(100);
      return tableResult(
        result,
        [
          { key: "shift_date", label: "Shift date", format: "date" },
          { key: "started_at", label: "Started", format: "datetime" },
          { key: "ended_at", label: "Ended", format: "datetime" },
          { key: "status", label: "Status", format: "status" },
          { key: "overtime_minutes", label: "Overtime" },
          { key: "payroll_eligible", label: "Payroll eligible" },
        ],
        "attendance",
      );
    }
    case "expenses": {
      const result = await supabase
        .from("expenses")
        .select("id, category, amount, reason, status, reviewed_at, created_at")
        .order("created_at", { ascending: false })
        .limit(100);
      return tableResult(
        result,
        [
          { key: "created_at", label: "Submitted", format: "datetime" },
          { key: "category", label: "Category" },
          { key: "amount", label: "Amount", format: "money" },
          { key: "reason", label: "Reason" },
          { key: "status", label: "Status", format: "status" },
          { key: "reviewed_at", label: "Reviewed", format: "datetime" },
        ],
        "expenses",
      );
    }
    case "leave": {
      const result = await supabase
        .from("leave_requests")
        .select("id, profile_id, start_date, end_date, reason, status, review_note, created_at")
        .order("start_date", { ascending: false })
        .limit(100);
      return tableResult(
        result,
        [
          { key: "start_date", label: "From", format: "date" },
          { key: "end_date", label: "To", format: "date" },
          { key: "reason", label: "Reason" },
          { key: "status", label: "Status", format: "status" },
          { key: "review_note", label: "Review note" },
        ],
        "leave requests",
      );
    }
    case "tasks": {
      const result = await supabase
        .from("tasks")
        .select(
          "id, title, description, due_at, priority, status, assigned_to_profile_id, completed_at, created_at",
        )
        .order("due_at", { ascending: true, nullsFirst: false })
        .limit(100);
      return tableResult(
        result,
        [
          { key: "title", label: "Task" },
          { key: "description", label: "Description" },
          { key: "due_at", label: "Due", format: "datetime" },
          { key: "priority", label: "Priority", format: "status" },
          { key: "status", label: "Status", format: "status" },
          { key: "completed_at", label: "Completed", format: "datetime" },
        ],
        "tasks",
      );
    }
    case "meetings": {
      const result = await supabase
        .from("meetings")
        .select("id, title, reason, starts_at, ends_at, location, meeting_url, status")
        .order("starts_at", { ascending: true })
        .limit(100);
      return tableResult(
        result,
        [
          { key: "title", label: "Meeting" },
          { key: "starts_at", label: "Starts", format: "datetime" },
          { key: "ends_at", label: "Ends", format: "datetime" },
          { key: "location", label: "Location" },
          { key: "status", label: "Status", format: "status" },
        ],
        "meetings",
      );
    }
    case "payroll": {
      const result = await supabase
        .from("payroll_entries")
        .select(
          "id, profile_id, temporary_worker_id, base_amount, attendance_amount, booking_earnings, overtime_amount, expense_reimbursement, deductions, net_payable, status, paid_at",
        )
        .order("created_at", { ascending: false })
        .limit(100);
      return tableResult(
        result,
        [
          { key: "base_amount", label: "Base", format: "money" },
          { key: "attendance_amount", label: "Attendance", format: "money" },
          { key: "booking_earnings", label: "Bookings", format: "money" },
          { key: "expense_reimbursement", label: "Expenses", format: "money" },
          { key: "deductions", label: "Deductions", format: "money" },
          { key: "net_payable", label: "Net payable", format: "money" },
          { key: "status", label: "Status", format: "status" },
          { key: "paid_at", label: "Paid", format: "datetime" },
        ],
        "payroll",
      );
    }
    case "reports": {
      const result = await supabase
        .from("bookings")
        .select("id, booking_code, event_date, total_value, payment_status, service_status")
        .order("event_date", { ascending: false })
        .limit(100);
      return tableResult(
        result,
        [
          { key: "booking_code", label: "Booking" },
          { key: "event_date", label: "Event date", format: "date" },
          { key: "total_value", label: "Value", format: "money" },
          { key: "payment_status", label: "Payment", format: "status" },
          { key: "service_status", label: "Service", format: "status" },
        ],
        "report data",
      );
    }
    case "login_sessions": {
      const result = await supabase
        .from("login_sessions")
        .select("id, profile_id, login_at, last_seen_at, logout_at, logout_reason, user_agent_safe")
        .order("login_at", { ascending: false })
        .limit(100);
      return tableResult(
        result,
        [
          { key: "login_at", label: "Login", format: "datetime" },
          { key: "last_seen_at", label: "Last seen", format: "datetime" },
          { key: "logout_at", label: "Logout", format: "datetime" },
          { key: "logout_reason", label: "Reason", format: "status" },
          { key: "user_agent_safe", label: "Device" },
        ],
        "login activity",
      );
    }
    case "integrations": {
      const result = await supabase
        .from("integration_connections")
        .select(
          "id, provider, status, account_identifier_safe, capabilities, connected_at, last_tested_at, last_success_at, last_error_safe",
        )
        .order("updated_at", { ascending: false })
        .limit(20);
      return tableResult(
        result,
        [
          { key: "provider", label: "Provider" },
          { key: "status", label: "Status", format: "status" },
          { key: "account_identifier_safe", label: "Account" },
          { key: "last_tested_at", label: "Last tested", format: "datetime" },
          { key: "last_success_at", label: "Last success", format: "datetime" },
          { key: "last_error_safe", label: "Last error" },
        ],
        "integration health",
      );
    }
    case "sync_runs": {
      const result = await supabase
        .from("integration_sync_runs")
        .select(
          "id, provider, sync_type, status, fetched_count, inserted_count, updated_count, duplicate_count, failed_count, started_at, completed_at, error_summary_safe",
        )
        .order("started_at", { ascending: false })
        .limit(100);
      return tableResult(
        result,
        [
          { key: "provider", label: "Provider" },
          { key: "sync_type", label: "Sync", format: "status" },
          { key: "status", label: "Status", format: "status" },
          { key: "fetched_count", label: "Fetched" },
          { key: "inserted_count", label: "Inserted" },
          { key: "updated_count", label: "Updated" },
          { key: "failed_count", label: "Failed" },
          { key: "started_at", label: "Started", format: "datetime" },
          { key: "completed_at", label: "Completed", format: "datetime" },
        ],
        "sync history",
      );
    }
    case "temporary_workers": {
      const result = await supabase
        .from("temporary_workers")
        .select(
          "id, full_name, phone_e164, worker_type, payment_type, payment_amount, is_active, created_at",
        )
        .order("full_name", { ascending: true })
        .limit(100);
      return tableResult(
        result,
        [
          { key: "full_name", label: "Name" },
          { key: "phone_e164", label: "Phone" },
          { key: "worker_type", label: "Type", format: "status" },
          { key: "payment_type", label: "Pay type", format: "status" },
          { key: "payment_amount", label: "Pay amount", format: "money" },
          { key: "is_active", label: "Active" },
        ],
        "temporary workers",
      );
    }
    default: {
      const exhaustive: never = resource;
      throw new Error(`Unsupported module resource: ${String(exhaustive)}`);
    }
  }
}
