"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import type { z } from "zod";

import { requireActiveSession } from "@/lib/auth/require-session";
import { normalizeIndianPhone } from "@/lib/auth/phone";
import type { AuthenticatedSession } from "@/lib/auth/types";
import type { Role } from "@/lib/constants/roles";
import { APP_ERROR_MESSAGES } from "@/lib/errors";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import {
  cancelLeaveRequestSchema,
  createExpenseSchema,
  createLeadSchema,
  createLeaveRequestSchema,
  createTaskSchema,
  reviewExpenseSchema,
  updateExpenseSchema,
  updateLeadSchema,
  updateLeadStatusSchema,
  updateLeaveRequestSchema,
  updateTaskSchema,
  updateTaskStatusSchema,
} from "./schemas";
import type { CrudActionState, ExpenseStatus } from "./types";

const SALES_DOMAIN_ROLES: readonly Role[] = ["director", "manager", "sales_manager", "sales"];
const TASK_CREATOR_ROLES: readonly Role[] = ["director", "manager", "hr", "sales_manager"];
const EXPENSE_BILL_MIME_EXTENSIONS: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};
const MAX_EXPENSE_BILL_BYTES = 8 * 1024 * 1024;

const DOMAIN_PATHS = {
  leads: [
    "/director/leads",
    "/manager/leads",
    "/sales-manager/leads",
    "/sales/leads",
    "/director/dashboard",
    "/manager/dashboard",
    "/sales-manager/dashboard",
    "/sales/dashboard",
  ],
  expenses: [
    "/director/expenses",
    "/manager/expenses",
    "/sales-manager/expenses",
    "/sales/expenses",
    "/chef/expenses",
    "/part-time-chef/expenses",
    "/hr/expenses",
    "/part-time-chef/expenses",
  ],
  leave: [
    "/director/leave",
    "/manager/leave",
    "/hr/leave",
    "/sales-manager/leave",
    "/sales/leave",
    "/chef/leave",
    "/part-time-chef/leave",
    "/part-time-chef/leave",
  ],
  tasks: [
    "/director/tasks",
    "/manager/tasks",
    "/sales-manager/tasks",
    "/sales/tasks",
    "/chef/tasks",
    "/part-time-chef/tasks",
  ],
} as const;

type CrudDomain = keyof typeof DOMAIN_PATHS;

function revalidateDomain(domain: CrudDomain): void {
  DOMAIN_PATHS[domain].forEach((path) => revalidatePath(path));
}

function inputFromFormData(formData: FormData): Record<string, FormDataEntryValue> {
  return Object.fromEntries(formData.entries());
}

function validationFailure(error: z.ZodError): CrudActionState {
  const fieldErrors: Record<string, string> = {};

  error.issues.forEach((issue) => {
    const field = issue.path[0];

    if (typeof field === "string" && fieldErrors[field] === undefined) {
      fieldErrors[field] = issue.message;
    }
  });

  return {
    status: "error",
    message: APP_ERROR_MESSAGES.VALIDATION_FAILED,
    mutationId: crypto.randomUUID(),
    fieldErrors,
  };
}

function failure(message: string, requestId?: string): CrudActionState {
  return {
    status: "error",
    message,
    mutationId: crypto.randomUUID(),
    ...(requestId ? { requestId } : {}),
  };
}

function success(message: string): CrudActionState {
  return {
    status: "success",
    message,
    mutationId: crypto.randomUUID(),
  };
}

function databaseErrorCode(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  ) {
    return error.code;
  }

  return "UNKNOWN";
}

function databaseFailure(
  operation: string,
  error: unknown,
  duplicateMessage?: string,
): CrudActionState {
  const requestId = crypto.randomUUID();
  const code = databaseErrorCode(error);

  console.error("[core-crud]", { operation, requestId, code });

  if (code === "23505" && duplicateMessage) {
    return failure(duplicateMessage);
  }

  if (code === "42501") {
    return failure(APP_ERROR_MESSAGES.PERMISSION_DENIED);
  }

  return failure("We could not save your changes. Refresh the page and try again.", requestId);
}

function staleFailure(): CrudActionState {
  return failure(APP_ERROR_MESSAGES.CONFLICT_STALE_VERSION);
}

function localDateTimeToIso(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  return new Date(`${value}:00+05:30`).toISOString();
}

async function findActiveProfileRole(
  supabase: SupabaseClient,
  profileId: string,
): Promise<{ role: Role } | null> {
  const result = await supabase
    .from("profiles")
    .select("role")
    .eq("id", profileId)
    .eq("account_status", "active")
    .is("deleted_at", null)
    .maybeSingle();

  if (result.error || !result.data) {
    return null;
  }

  const role = result.data.role as unknown;
  const roles: readonly string[] = [
    "director",
    "manager",
    "hr",
    "sales_manager",
    "sales",
    "chef",
    "part_time_chef",
  ];

  return typeof role === "string" && roles.includes(role) ? { role: role as Role } : null;
}

function canAssignTask(actorRole: Role, assigneeRole: Role): boolean {
  switch (actorRole) {
    case "director":
      return true;
    case "manager":
      return assigneeRole !== "director";
    case "hr":
      return assigneeRole === "chef" || assigneeRole === "part_time_chef";
    case "sales_manager":
      return assigneeRole === "sales_manager" || assigneeRole === "sales";
    default:
      return false;
  }
}

async function validateTaskAssignee(
  supabase: SupabaseClient,
  session: AuthenticatedSession,
  profileId: string,
): Promise<boolean> {
  const profile = await findActiveProfileRole(supabase, profileId);
  return profile ? canAssignTask(session.profile.role, profile.role) : false;
}

async function validateSalesAssignee(
  supabase: SupabaseClient,
  profileId: string,
): Promise<boolean> {
  const profile = await findActiveProfileRole(supabase, profileId);
  return profile?.role === "sales";
}

export async function createLeadAction(
  _previousState: CrudActionState,
  formData: FormData,
): Promise<CrudActionState> {
  const session = await requireActiveSession();

  if (!SALES_DOMAIN_ROLES.includes(session.profile.role)) {
    return failure(APP_ERROR_MESSAGES.PERMISSION_DENIED);
  }

  const parsed = createLeadSchema.safeParse(inputFromFormData(formData));

  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  let phoneE164: string;

  try {
    phoneE164 = normalizeIndianPhone(parsed.data.phone);
  } catch {
    return {
      ...failure(APP_ERROR_MESSAGES.VALIDATION_FAILED),
      fieldErrors: {
        phone: "Enter a valid 10-digit Indian mobile number.",
      },
    };
  }

  const supabase = await createServerSupabaseClient();
  let assignedSalesProfileId: string | null = null;

  if (session.profile.role === "sales") {
    assignedSalesProfileId = session.userId;
  } else if (parsed.data.assignedSalesProfileId) {
    const isValidAssignee = await validateSalesAssignee(
      supabase,
      parsed.data.assignedSalesProfileId,
    );

    if (!isValidAssignee) {
      return failure("Choose an active Sales Member from your organization.");
    }

    assignedSalesProfileId = parsed.data.assignedSalesProfileId;
  }

  const result = await supabase
    .from("leads")
    .insert({
      organization_id: session.profile.organization_id,
      provider: "manual",
      source: parsed.data.source ?? "manual",
      client_name: parsed.data.clientName,
      customer_email: parsed.data.customerEmail ?? null,
      phone_e164: phoneE164,
      phone_normalized: phoneE164,
      requirement: parsed.data.requirement ?? null,
      event_date: parsed.data.eventDate ?? null,
      guest_count: parsed.data.guestCount ?? null,
      quote_amount: parsed.data.quoteAmount ?? null,
      notes: parsed.data.notes ?? null,
      assigned_sales_profile_id: assignedSalesProfileId,
      created_by_profile_id: session.userId,
    })
    .select("id")
    .single();

  if (result.error) {
    return databaseFailure(
      "create-lead",
      result.error,
      "A lead with this phone number already exists.",
    );
  }

  revalidateDomain("leads");
  return success("Lead created.");
}

export async function updateLeadAction(
  _previousState: CrudActionState,
  formData: FormData,
): Promise<CrudActionState> {
  const session = await requireActiveSession();

  if (!SALES_DOMAIN_ROLES.includes(session.profile.role)) {
    return failure(APP_ERROR_MESSAGES.PERMISSION_DENIED);
  }

  const parsed = updateLeadSchema.safeParse(inputFromFormData(formData));

  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  let phoneE164: string;

  try {
    phoneE164 = normalizeIndianPhone(parsed.data.phone);
  } catch {
    return {
      ...failure(APP_ERROR_MESSAGES.VALIDATION_FAILED),
      fieldErrors: {
        phone: "Enter a valid 10-digit Indian mobile number.",
      },
    };
  }

  const supabase = await createServerSupabaseClient();
  const result = await supabase
    .from("leads")
    .update({
      client_name: parsed.data.clientName,
      customer_email: parsed.data.customerEmail ?? null,
      phone_e164: phoneE164,
      phone_normalized: phoneE164,
      requirement: parsed.data.requirement ?? null,
      event_date: parsed.data.eventDate ?? null,
      guest_count: parsed.data.guestCount ?? null,
      quote_amount: parsed.data.quoteAmount ?? null,
      notes: parsed.data.notes ?? null,
      last_activity_at: new Date().toISOString(),
    })
    .eq("id", parsed.data.id)
    .eq("version", parsed.data.expectedVersion)
    .select("id,version")
    .maybeSingle();

  if (result.error) {
    return databaseFailure(
      "update-lead",
      result.error,
      "A lead with this phone number already exists.",
    );
  }

  if (!result.data) {
    return staleFailure();
  }

  revalidateDomain("leads");
  return success("Lead updated.");
}

export async function updateLeadStatusAction(
  _previousState: CrudActionState,
  formData: FormData,
): Promise<CrudActionState> {
  const session = await requireActiveSession();

  if (!SALES_DOMAIN_ROLES.includes(session.profile.role)) {
    return failure(APP_ERROR_MESSAGES.PERMISSION_DENIED);
  }

  const parsed = updateLeadStatusSchema.safeParse(inputFromFormData(formData));

  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  const supabase = await createServerSupabaseClient();
  const result = await supabase.rpc("transition_lead_stage", {
    p_expected_version: parsed.data.expectedVersion,
    p_lead_id: parsed.data.id,
    p_reason: parsed.data.reason ?? null,
    p_to_status: parsed.data.status,
  });

  if (result.error) {
    const message = typeof result.error.message === "string" ? result.error.message : "";
    if (message.includes("CONFLICT_STALE_VERSION")) return staleFailure();
    if (message.includes("LEAD_QUALIFICATION_INCOMPLETE")) {
      return failure(
        "Add the event date, guest count, requirement and quote before qualifying this lead.",
      );
    }
    if (
      message.includes("INVALID_TERMINAL_LEAD_TRANSITION") ||
      message.includes("LEAD_REOPEN_REQUIRES_MANAGER")
    ) {
      return failure("This stage change needs a valid reason and Manager-level authority.");
    }
    return databaseFailure("update-lead-status", result.error);
  }

  revalidateDomain("leads");
  return success("Lead status updated.");
}

export async function createExpenseAction(
  _previousState: CrudActionState,
  formData: FormData,
): Promise<CrudActionState> {
  const session = await requireActiveSession();
  const parsed = createExpenseSchema.safeParse(inputFromFormData(formData));

  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  const bill = formData.get("bill");
  const extension =
    bill instanceof File && bill.size > 0 ? EXPENSE_BILL_MIME_EXTENSIONS[bill.type] : undefined;

  if (!(bill instanceof File) || bill.size === 0) {
    return failure("Upload the expense bill.");
  }

  if (!extension) {
    return failure("Upload a JPG, PNG, WebP, or PDF bill.");
  }

  if (bill.size > MAX_EXPENSE_BILL_BYTES) {
    return failure("The bill must be 8 MB or smaller.");
  }

  const supabase = await createServerSupabaseClient();
  const expenseId = crypto.randomUUID();
  const storagePath = [
    session.profile.organization_id,
    session.userId,
    expenseId,
    `${crypto.randomUUID()}.${extension}`,
  ].join("/");
  const uploadResult = await supabase.storage.from("expense-bills").upload(storagePath, bill, {
    cacheControl: "3600",
    contentType: bill.type,
    upsert: false,
  });

  if (uploadResult.error) {
    return databaseFailure("upload-expense-bill", uploadResult.error);
  }

  const result = await supabase.rpc("submit_expense_claim", {
    p_expense_id: expenseId,
    p_booking_id: parsed.data.bookingId ?? null,
    p_category: parsed.data.category,
    p_amount: parsed.data.amount,
    p_reason: parsed.data.reason,
    p_storage_path: storagePath,
    p_file_name: bill.name,
    p_mime_type: bill.type,
    p_size_bytes: bill.size,
  });

  if (result.error) {
    await supabase.storage.from("expense-bills").remove([storagePath]);
    return databaseFailure("create-expense", result.error);
  }

  revalidateDomain("expenses");
  return success("Expense submitted for review.");
}

export async function updateExpenseAction(
  _previousState: CrudActionState,
  formData: FormData,
): Promise<CrudActionState> {
  const session = await requireActiveSession();
  const parsed = updateExpenseSchema.safeParse(inputFromFormData(formData));

  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  const supabase = await createServerSupabaseClient();
  const result = await supabase
    .from("expenses")
    .update({
      booking_id: parsed.data.bookingId ?? null,
      category: parsed.data.category,
      amount: parsed.data.amount,
      reason: parsed.data.reason,
    })
    .eq("id", parsed.data.id)
    .eq("submitted_by_profile_id", session.userId)
    .eq("status", "pending")
    .eq("updated_at", parsed.data.expectedUpdatedAt)
    .select("id")
    .maybeSingle();

  if (result.error) {
    return databaseFailure("update-expense", result.error);
  }

  if (!result.data) {
    return staleFailure();
  }

  revalidateDomain("expenses");
  return success("Expense updated.");
}

export async function reviewExpenseAction(
  _previousState: CrudActionState,
  formData: FormData,
): Promise<CrudActionState> {
  const session = await requireActiveSession();
  const parsed = reviewExpenseSchema.safeParse(inputFromFormData(formData));

  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  const allowedStatuses: Partial<Record<Role, readonly ExpenseStatus[]>> = {
    hr: ["verified", "rejected"],
    manager: ["verified", "approved", "rejected"],
    director: ["verified", "approved", "rejected", "paid"],
  };
  const permitted = allowedStatuses[session.profile.role] ?? [];

  if (!permitted.includes(parsed.data.status)) {
    return failure(APP_ERROR_MESSAGES.PERMISSION_DENIED);
  }

  const supabase = await createServerSupabaseClient();
  const result = await supabase
    .from("expenses")
    .update({
      status: parsed.data.status,
      reviewed_by_profile_id: session.userId,
      reviewed_at: new Date().toISOString(),
      rejection_reason:
        parsed.data.status === "rejected" ? (parsed.data.rejectionReason ?? null) : null,
    })
    .eq("id", parsed.data.id)
    .eq("updated_at", parsed.data.expectedUpdatedAt)
    .select("id")
    .maybeSingle();

  if (result.error) {
    return databaseFailure("review-expense", result.error);
  }

  if (!result.data) {
    return staleFailure();
  }

  revalidateDomain("expenses");
  return success(`Expense marked ${parsed.data.status}.`);
}

export async function createLeaveRequestAction(
  _previousState: CrudActionState,
  formData: FormData,
): Promise<CrudActionState> {
  const session = await requireActiveSession();
  const parsed = createLeaveRequestSchema.safeParse(inputFromFormData(formData));

  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  const supabase = await createServerSupabaseClient();
  const result = await supabase
    .from("leave_requests")
    .insert({
      organization_id: session.profile.organization_id,
      profile_id: session.userId,
      start_date: parsed.data.startDate,
      end_date: parsed.data.endDate,
      reason: parsed.data.reason,
      status: "pending",
    })
    .select("id")
    .single();

  if (result.error) {
    return databaseFailure("create-leave-request", result.error);
  }

  revalidateDomain("leave");
  return success("Leave request submitted.");
}

export async function updateLeaveRequestAction(
  _previousState: CrudActionState,
  formData: FormData,
): Promise<CrudActionState> {
  const session = await requireActiveSession();
  const parsed = updateLeaveRequestSchema.safeParse(inputFromFormData(formData));

  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  const supabase = await createServerSupabaseClient();
  const result = await supabase
    .from("leave_requests")
    .update({
      start_date: parsed.data.startDate,
      end_date: parsed.data.endDate,
      reason: parsed.data.reason,
    })
    .eq("id", parsed.data.id)
    .eq("profile_id", session.userId)
    .eq("status", "pending")
    .eq("updated_at", parsed.data.expectedUpdatedAt)
    .select("id")
    .maybeSingle();

  if (result.error) {
    return databaseFailure("update-leave-request", result.error);
  }

  if (!result.data) {
    return staleFailure();
  }

  revalidateDomain("leave");
  return success("Leave request updated.");
}

export async function cancelLeaveRequestAction(
  _previousState: CrudActionState,
  formData: FormData,
): Promise<CrudActionState> {
  const session = await requireActiveSession();
  const parsed = cancelLeaveRequestSchema.safeParse(inputFromFormData(formData));

  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  const supabase = await createServerSupabaseClient();
  const result = await supabase
    .from("leave_requests")
    .update({ status: "cancelled" })
    .eq("id", parsed.data.id)
    .eq("profile_id", session.userId)
    .eq("status", "pending")
    .eq("updated_at", parsed.data.expectedUpdatedAt)
    .select("id")
    .maybeSingle();

  if (result.error) {
    return databaseFailure("cancel-leave-request", result.error);
  }

  if (!result.data) {
    return staleFailure();
  }

  revalidateDomain("leave");
  return success("Leave request cancelled.");
}

export async function createTaskAction(
  _previousState: CrudActionState,
  formData: FormData,
): Promise<CrudActionState> {
  const session = await requireActiveSession();

  if (!TASK_CREATOR_ROLES.includes(session.profile.role)) {
    return failure(APP_ERROR_MESSAGES.PERMISSION_DENIED);
  }

  const parsed = createTaskSchema.safeParse(inputFromFormData(formData));

  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  const supabase = await createServerSupabaseClient();

  if (!(await validateTaskAssignee(supabase, session, parsed.data.assignedToProfileId))) {
    return failure("Choose an active team member you are allowed to assign.");
  }

  const result = await supabase
    .from("tasks")
    .insert({
      organization_id: session.profile.organization_id,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      assigned_to_profile_id: parsed.data.assignedToProfileId,
      assigned_by_profile_id: session.userId,
      booking_id: parsed.data.bookingId ?? null,
      lead_id: parsed.data.leadId ?? null,
      due_at: localDateTimeToIso(parsed.data.dueAt),
      priority: parsed.data.priority,
      status: "open",
    })
    .select("id")
    .single();

  if (result.error) {
    return databaseFailure("create-task", result.error);
  }

  revalidateDomain("tasks");
  return success("Task assigned.");
}

export async function updateTaskAction(
  _previousState: CrudActionState,
  formData: FormData,
): Promise<CrudActionState> {
  const session = await requireActiveSession();

  if (!TASK_CREATOR_ROLES.includes(session.profile.role)) {
    return failure(APP_ERROR_MESSAGES.PERMISSION_DENIED);
  }

  const parsed = updateTaskSchema.safeParse(inputFromFormData(formData));

  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  const supabase = await createServerSupabaseClient();

  if (!(await validateTaskAssignee(supabase, session, parsed.data.assignedToProfileId))) {
    return failure("Choose an active team member you are allowed to assign.");
  }

  const existing = await supabase
    .from("tasks")
    .select("assigned_by_profile_id")
    .eq("id", parsed.data.id)
    .eq("updated_at", parsed.data.expectedUpdatedAt)
    .maybeSingle();

  if (existing.error) {
    return databaseFailure("load-task-for-update", existing.error);
  }

  if (!existing.data) {
    return staleFailure();
  }

  if (
    session.profile.role !== "director" &&
    session.profile.role !== "manager" &&
    existing.data.assigned_by_profile_id !== session.userId
  ) {
    return failure(APP_ERROR_MESSAGES.PERMISSION_DENIED);
  }

  const result = await supabase
    .from("tasks")
    .update({
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      assigned_to_profile_id: parsed.data.assignedToProfileId,
      booking_id: parsed.data.bookingId ?? null,
      lead_id: parsed.data.leadId ?? null,
      due_at: localDateTimeToIso(parsed.data.dueAt),
      priority: parsed.data.priority,
    })
    .eq("id", parsed.data.id)
    .eq("updated_at", parsed.data.expectedUpdatedAt)
    .select("id")
    .maybeSingle();

  if (result.error) {
    return databaseFailure("update-task", result.error);
  }

  if (!result.data) {
    return staleFailure();
  }

  revalidateDomain("tasks");
  return success("Task updated.");
}

export async function updateTaskStatusAction(
  _previousState: CrudActionState,
  formData: FormData,
): Promise<CrudActionState> {
  await requireActiveSession();
  const parsed = updateTaskStatusSchema.safeParse(inputFromFormData(formData));

  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  const supabase = await createServerSupabaseClient();
  const result = await supabase
    .from("tasks")
    .update({
      status: parsed.data.status,
      completed_at: parsed.data.status === "completed" ? new Date().toISOString() : null,
    })
    .eq("id", parsed.data.id)
    .eq("updated_at", parsed.data.expectedUpdatedAt)
    .select("id")
    .maybeSingle();

  if (result.error) {
    return databaseFailure("update-task-status", result.error);
  }

  if (!result.data) {
    return staleFailure();
  }

  revalidateDomain("tasks");
  return success("Task status updated.");
}
