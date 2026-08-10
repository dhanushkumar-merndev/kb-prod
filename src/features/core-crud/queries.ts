import "server-only";

import { z } from "zod";

import { requireActiveSession } from "@/lib/auth/require-session";
import { ROLES, type Role } from "@/lib/constants/roles";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import {
  EXPENSE_STATUSES,
  LEAD_STATUSES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type CrudLoadState,
  type ExpenseRecord,
  type LeadCrudData,
  type LeadRecord,
  type LeaveRequestRecord,
  type OwnExpenseCrudData,
  type OwnLeaveCrudData,
  type SafeProfileOption,
  type TaskCrudData,
  type TaskRecord,
} from "./types";

const moneySchema = z.union([z.string(), z.number()]).transform((value) => String(value));

const leadRowSchema = z.object({
  id: z.string().uuid(),
  client_name: z.string(),
  customer_email: z.string().email().nullable(),
  phone_e164: z.string(),
  source: z.string().nullable(),
  requirement: z.string().nullable(),
  event_date: z.string().nullable(),
  guest_count: z.number().int().nullable(),
  quote_amount: moneySchema.nullable(),
  status: z.enum(LEAD_STATUSES),
  assigned_sales_profile_id: z.string().uuid().nullable(),
  next_follow_up_at: z.string().nullable(),
  notes: z.string().nullable(),
  version: z.number().int().positive(),
  created_at: z.string(),
  updated_at: z.string(),
});

const leadPageSchema = z.object({
  total: z.coerce.number().int().nonnegative(),
  rows: z.array(leadRowSchema),
});

const expenseRowSchema = z.object({
  id: z.string().uuid(),
  booking_id: z.string().uuid().nullable(),
  category: z.string(),
  amount: moneySchema,
  reason: z.string(),
  status: z.enum(EXPENSE_STATUSES),
  rejection_reason: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

const expenseAttachmentRowSchema = z.object({
  id: z.string().uuid(),
  expense_id: z.string().uuid(),
  storage_path: z.string(),
  file_name: z.string(),
});

const expenseBookingRowSchema = z.object({
  id: z.string().uuid(),
  booking_code: z.string(),
  client_name: z.string(),
  event_date: z.string(),
});

const leaveRowSchema = z.object({
  id: z.string().uuid(),
  start_date: z.string(),
  end_date: z.string(),
  reason: z.string(),
  status: z.enum(["pending", "approved", "rejected", "cancelled"]),
  review_note: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

const taskRowSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  assigned_to_profile_id: z.string().uuid(),
  assigned_by_profile_id: z.string().uuid(),
  booking_id: z.string().uuid().nullable(),
  lead_id: z.string().uuid().nullable(),
  due_at: z.string().nullable(),
  priority: z.enum(TASK_PRIORITIES),
  status: z.enum(TASK_STATUSES),
  completed_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

const safeProfileRowSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string(),
  role: z.enum(ROLES),
});

function loadFailure(operation: string, error: unknown): CrudLoadState<never> {
  const requestId = crypto.randomUUID();
  const code =
    typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
      ? error.code
      : "UNKNOWN";

  console.error("[core-crud]", { operation, requestId, code });

  return {
    ok: false,
    message: "We could not load this information. Refresh the page and try again.",
    requestId,
  };
}

function parseRows<T>(schema: z.ZodType<T>, rows: unknown): T[] {
  return z.array(schema).parse(rows ?? []);
}

function toLeadRecord(row: z.infer<typeof leadRowSchema>): LeadRecord {
  return {
    id: row.id,
    clientName: row.client_name,
    customerEmail: row.customer_email,
    phoneE164: row.phone_e164,
    source: row.source,
    requirement: row.requirement,
    eventDate: row.event_date,
    guestCount: row.guest_count,
    quoteAmount: row.quote_amount,
    status: row.status,
    assignedSalesProfileId: row.assigned_sales_profile_id,
    nextFollowUpAt: row.next_follow_up_at,
    notes: row.notes,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toExpenseRecord(
  row: z.infer<typeof expenseRowSchema>,
  attachments: ExpenseRecord["attachments"],
): ExpenseRecord {
  return {
    id: row.id,
    bookingId: row.booking_id,
    category: row.category,
    amount: row.amount,
    reason: row.reason,
    status: row.status,
    rejectionReason: row.rejection_reason,
    attachments,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toLeaveRecord(row: z.infer<typeof leaveRowSchema>): LeaveRequestRecord {
  return {
    id: row.id,
    startDate: row.start_date,
    endDate: row.end_date,
    reason: row.reason,
    status: row.status,
    reviewNote: row.review_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toTaskRecord(row: z.infer<typeof taskRowSchema>): TaskRecord {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    assignedToProfileId: row.assigned_to_profile_id,
    assignedByProfileId: row.assigned_by_profile_id,
    bookingId: row.booking_id,
    leadId: row.lead_id,
    dueAt: row.due_at,
    priority: row.priority,
    status: row.status,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toSafeProfile(row: z.infer<typeof safeProfileRowSchema>): SafeProfileOption {
  return {
    id: row.id,
    fullName: row.full_name,
    role: row.role,
  };
}

const SALES_DOMAIN_ROLES: readonly Role[] = [
  "director",
  "franchise",
  "manager",
  "sales_manager",
  "sales",
];
const TASK_CREATOR_ROLES: readonly Role[] = ["director", "manager", "hr", "sales_manager"];

function taskAssigneeRoles(role: Role): Role[] {
  switch (role) {
    case "director":
      return [...ROLES];
    case "franchise":
    case "manager":
      return ["manager", "hr", "sales_manager", "sales", "chef", "part_time_chef"];
    case "hr":
      return ["chef", "part_time_chef"];
    case "sales_manager":
      return ["sales_manager", "sales"];
    default:
      return [];
  }
}

export async function loadLeadCrudData(
  options: { page?: number | undefined; search?: string | undefined } = {},
): Promise<CrudLoadState<LeadCrudData>> {
  const session = await requireActiveSession();

  if (!SALES_DOMAIN_ROLES.includes(session.profile.role)) {
    return {
      ok: false,
      message: "You do not have permission to view leads.",
      requestId: crypto.randomUUID(),
    };
  }

  const supabase = await createServerSupabaseClient();
  const pageSize = 10;
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const search = (options.search ?? "").trim().slice(0, 80);
  const safeSearch = search
    .replace(/[,%()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const leadQuery = supabase.rpc("get_leads_page", {
    p_page: page,
    p_page_size: pageSize,
    p_search: safeSearch || null,
  });

  const assigneeQuery = supabase
    .from("profiles")
    .select("id,full_name,role")
    .eq("account_status", "active")
    .eq("role", "sales")
    .is("deleted_at", null)
    .order("full_name", { ascending: true });

  const [leadResult, assigneeResult] = await Promise.all([leadQuery, assigneeQuery]);

  if (leadResult.error) {
    return loadFailure("load-leads", leadResult.error);
  }

  if (assigneeResult.error) {
    return loadFailure("load-lead-assignees", assigneeResult.error);
  }

  try {
    const leadPage = leadPageSchema.parse(leadResult.data);
    const leads = leadPage.rows.map(toLeadRecord);
    const salesAssignees = parseRows(safeProfileRowSchema, assigneeResult.data).map(toSafeProfile);

    return {
      ok: true,
      data: {
        viewerId: session.userId,
        viewerRole: session.profile.role,
        leads,
        salesAssignees,
        page,
        pageSize,
        search,
        total: leadPage.total,
      },
    };
  } catch (error) {
    return loadFailure("parse-leads", error);
  }
}

export async function loadOwnExpenseCrudData(): Promise<CrudLoadState<OwnExpenseCrudData>> {
  const session = await requireActiveSession();
  const supabase = await createServerSupabaseClient();
  const [expenseResult, bookingResult] = await Promise.all([
    supabase
      .from("expenses")
      .select("id,booking_id,category,amount,reason,status,rejection_reason,created_at,updated_at")
      .eq("submitted_by_profile_id", session.userId)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("bookings")
      .select("id,booking_code,client_name,event_date")
      .is("deleted_at", null)
      .order("event_date", { ascending: false })
      .limit(100),
  ]);

  if (expenseResult.error) {
    return loadFailure("load-own-expenses", expenseResult.error);
  }

  if (bookingResult.error) {
    return loadFailure("load-expense-bookings", bookingResult.error);
  }

  try {
    const expenseRows = parseRows(expenseRowSchema, expenseResult.data);
    const expenseIds = expenseRows.map((expense) => expense.id);
    const attachmentResult =
      expenseIds.length === 0
        ? { data: [], error: null }
        : await supabase
            .from("expense_attachments")
            .select("id,expense_id,storage_path,file_name")
            .in("expense_id", expenseIds);

    if (attachmentResult.error) {
      return loadFailure("load-expense-attachments", attachmentResult.error);
    }

    const attachmentRows = parseRows(expenseAttachmentRowSchema, attachmentResult.data);
    const signedResult =
      attachmentRows.length === 0
        ? { data: [], error: null }
        : await supabase.storage.from("expense-bills").createSignedUrls(
            attachmentRows.map((attachment) => attachment.storage_path),
            300,
          );

    if (signedResult.error) {
      return loadFailure("sign-expense-attachments", signedResult.error);
    }

    const signedUrlsByPath = new Map(
      (signedResult.data ?? []).flatMap((entry) =>
        entry.signedUrl && entry.path ? [[entry.path, entry.signedUrl] as const] : [],
      ),
    );
    const attachmentsByExpense = new Map<string, ExpenseRecord["attachments"]>();

    for (const attachment of attachmentRows) {
      const signedUrl = signedUrlsByPath.get(attachment.storage_path);

      if (!signedUrl) {
        continue;
      }

      const current = attachmentsByExpense.get(attachment.expense_id) ?? [];
      current.push({
        id: attachment.id,
        fileName: attachment.file_name,
        signedUrl,
      });
      attachmentsByExpense.set(attachment.expense_id, current);
    }

    return {
      ok: true,
      data: {
        viewerId: session.userId,
        viewerRole: session.profile.role,
        expenses: expenseRows.map((expense) =>
          toExpenseRecord(expense, attachmentsByExpense.get(expense.id) ?? []),
        ),
        bookings: parseRows(expenseBookingRowSchema, bookingResult.data).map((booking) => ({
          id: booking.id,
          bookingCode: booking.booking_code,
          clientName: booking.client_name,
          eventDate: booking.event_date,
        })),
      },
    };
  } catch (error) {
    return loadFailure("parse-own-expenses", error);
  }
}

export async function loadOwnLeaveCrudData(): Promise<CrudLoadState<OwnLeaveCrudData>> {
  const session = await requireActiveSession();
  const supabase = await createServerSupabaseClient();
  const result = await supabase
    .from("leave_requests")
    .select("id,start_date,end_date,reason,status,review_note,created_at,updated_at")
    .eq("profile_id", session.userId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (result.error) {
    return loadFailure("load-own-leave", result.error);
  }

  try {
    return {
      ok: true,
      data: {
        viewerId: session.userId,
        viewerRole: session.profile.role,
        leaveRequests: parseRows(leaveRowSchema, result.data).map(toLeaveRecord),
      },
    };
  } catch (error) {
    return loadFailure("parse-own-leave", error);
  }
}

export async function loadTaskCrudData(): Promise<CrudLoadState<TaskCrudData>> {
  const session = await requireActiveSession();
  const supabase = await createServerSupabaseClient();
  const canCreate = TASK_CREATOR_ROLES.includes(session.profile.role);

  const tasksQuery = supabase
    .from("tasks")
    .select(
      "id,title,description,assigned_to_profile_id,assigned_by_profile_id,booking_id,lead_id,due_at,priority,status,completed_at,created_at,updated_at",
    )
    .order("created_at", { ascending: false })
    .limit(100);

  const roles = taskAssigneeRoles(session.profile.role);
  const assigneesQuery = canCreate
    ? supabase
        .from("profiles")
        .select("id,full_name,role")
        .eq("account_status", "active")
        .is("deleted_at", null)
        .in("role", roles)
        .order("full_name", { ascending: true })
    : null;

  const [tasksResult, assigneesResult] = await Promise.all([
    tasksQuery,
    assigneesQuery ?? Promise.resolve({ data: [], error: null }),
  ]);

  if (tasksResult.error) {
    return loadFailure("load-tasks", tasksResult.error);
  }

  if (assigneesResult.error) {
    return loadFailure("load-task-assignees", assigneesResult.error);
  }

  try {
    return {
      ok: true,
      data: {
        viewerId: session.userId,
        viewerRole: session.profile.role,
        tasks: parseRows(taskRowSchema, tasksResult.data).map(toTaskRecord),
        assignees: parseRows(safeProfileRowSchema, assigneesResult.data).map(toSafeProfile),
        canCreate,
      },
    };
  } catch (error) {
    return loadFailure("parse-tasks", error);
  }
}
