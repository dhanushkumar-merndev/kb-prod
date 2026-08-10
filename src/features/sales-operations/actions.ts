"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";

import { requireActiveSession } from "@/lib/auth/require-session";
import type { Role } from "@/lib/constants/roles";
import { APP_ERROR_MESSAGES } from "@/lib/errors";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import type { CrudActionState } from "../core-crud/types";
import {
  addLeadNoteSchema,
  assignLeadSchema,
  createFollowUpSchema,
  logSalesCallSchema,
  updateFollowUpSchema,
} from "./schemas";

const SALES_ROLES: readonly Role[] = ["director", "franchise", "manager", "sales_manager", "sales"];
const ASSIGNMENT_ROLES: readonly Role[] = ["director", "franchise", "manager", "sales_manager"];

const SALES_PATHS = [
  "/director/leads",
  "/franchise/leads",
  "/manager/leads",
  "/sales-manager/leads",
  "/sales-manager/assignment",
  "/sales-manager/follow-ups",
  "/sales-manager/calls",
  "/sales/leads",
  "/sales/follow-ups",
  "/sales/calls",
] as const;

function revalidateSales(): void {
  SALES_PATHS.forEach((path) => revalidatePath(path));
}

function formInput(formData: FormData): Record<string, FormDataEntryValue> {
  return Object.fromEntries(formData.entries());
}

function success(message: string): CrudActionState {
  return { status: "success", message, mutationId: crypto.randomUUID() };
}

function failure(message: string, requestId?: string): CrudActionState {
  return {
    status: "error",
    message,
    mutationId: crypto.randomUUID(),
    ...(requestId ? { requestId } : {}),
  };
}

function validationFailure(error: z.ZodError): CrudActionState {
  const fieldErrors: Record<string, string> = {};
  error.issues.forEach((issue) => {
    const field = issue.path[0];
    if (typeof field === "string" && !fieldErrors[field]) {
      fieldErrors[field] = issue.message;
    }
  });
  return {
    ...failure(APP_ERROR_MESSAGES.VALIDATION_FAILED),
    fieldErrors,
  };
}

function rpcFailure(operation: string, error: unknown): CrudActionState {
  const requestId = crypto.randomUUID();
  const text =
    typeof error === "object" && error !== null && "message" in error ? String(error.message) : "";
  const code =
    typeof error === "object" && error !== null && "code" in error ? String(error.code) : "UNKNOWN";
  console.error("[sales-operations]", { operation, requestId, code });

  if (text.includes("CONFLICT_STALE_VERSION")) {
    return failure(APP_ERROR_MESSAGES.CONFLICT_STALE_VERSION);
  }
  if (text.includes("PERMISSION_DENIED") || code === "42501") {
    return failure(APP_ERROR_MESSAGES.PERMISSION_DENIED);
  }
  if (text.includes("NOT_FOUND")) {
    return failure("This record no longer exists. Refresh and try again.");
  }
  if (text.includes("VALIDATION_FAILED")) {
    return failure(APP_ERROR_MESSAGES.VALIDATION_FAILED);
  }
  return failure("We could not save this change. Refresh and try again.", requestId);
}

function indiaLocalToIso(value: string): string {
  return new Date(`${value}:00+05:30`).toISOString();
}

async function requireSalesRole(roles: readonly Role[]): Promise<CrudActionState | null> {
  const session = await requireActiveSession();
  return roles.includes(session.profile.role)
    ? null
    : failure(APP_ERROR_MESSAGES.PERMISSION_DENIED);
}

export async function assignLeadAction(
  _previousState: CrudActionState,
  formData: FormData,
): Promise<CrudActionState> {
  const denied = await requireSalesRole(ASSIGNMENT_ROLES);
  if (denied) return denied;

  const parsed = assignLeadSchema.safeParse(formInput(formData));
  if (!parsed.success) return validationFailure(parsed.error);

  const supabase = await createServerSupabaseClient();
  const result = await supabase.rpc("assign_lead", {
    p_lead_id: parsed.data.leadId,
    p_assigned_sales_profile_id: parsed.data.assignedSalesProfileId,
    p_expected_version: parsed.data.expectedVersion,
    p_reason: parsed.data.reason,
  });
  if (result.error) return rpcFailure("assign-lead", result.error);

  revalidateSales();
  const changed =
    Array.isArray(result.data) &&
    result.data[0] &&
    typeof result.data[0] === "object" &&
    "changed" in result.data[0]
      ? result.data[0].changed === true
      : true;
  return success(changed ? "Lead assignment updated." : "Lead was already assigned that way.");
}

export async function createFollowUpAction(
  _previousState: CrudActionState,
  formData: FormData,
): Promise<CrudActionState> {
  const denied = await requireSalesRole(SALES_ROLES);
  if (denied) return denied;

  const parsed = createFollowUpSchema.safeParse(formInput(formData));
  if (!parsed.success) return validationFailure(parsed.error);

  const supabase = await createServerSupabaseClient();
  const result = await supabase.rpc("create_sales_follow_up", {
    p_lead_id: parsed.data.leadId,
    p_assigned_profile_id: parsed.data.assignedProfileId,
    p_due_at: indiaLocalToIso(parsed.data.dueAt),
  });
  if (result.error) return rpcFailure("create-follow-up", result.error);

  revalidateSales();
  return success("Follow-up scheduled.");
}

export async function updateFollowUpAction(
  _previousState: CrudActionState,
  formData: FormData,
): Promise<CrudActionState> {
  const denied = await requireSalesRole(SALES_ROLES);
  if (denied) return denied;

  const parsed = updateFollowUpSchema.safeParse(formInput(formData));
  if (!parsed.success) return validationFailure(parsed.error);

  const supabase = await createServerSupabaseClient();
  const result = await supabase.rpc("update_sales_follow_up", {
    p_follow_up_id: parsed.data.followUpId,
    p_expected_updated_at: parsed.data.expectedUpdatedAt,
    p_due_at: indiaLocalToIso(parsed.data.dueAt),
    p_status: parsed.data.status,
    p_outcome: parsed.data.outcome,
  });
  if (result.error) return rpcFailure("update-follow-up", result.error);

  revalidateSales();
  return success(
    parsed.data.status === "completed"
      ? "Follow-up completed."
      : parsed.data.status === "cancelled"
        ? "Follow-up cancelled."
        : "Follow-up updated.",
  );
}

export async function addLeadNoteAction(
  _previousState: CrudActionState,
  formData: FormData,
): Promise<CrudActionState> {
  const denied = await requireSalesRole(SALES_ROLES);
  if (denied) return denied;

  const parsed = addLeadNoteSchema.safeParse(formInput(formData));
  if (!parsed.success) return validationFailure(parsed.error);

  const supabase = await createServerSupabaseClient();
  const result = await supabase.rpc("add_lead_note", {
    p_lead_id: parsed.data.leadId,
    p_note: parsed.data.note,
  });
  if (result.error) return rpcFailure("add-lead-note", result.error);

  revalidateSales();
  return success("Internal note added.");
}

export async function logSalesCallAction(
  _previousState: CrudActionState,
  formData: FormData,
): Promise<CrudActionState> {
  const denied = await requireSalesRole(SALES_ROLES);
  if (denied) return denied;

  const parsed = logSalesCallSchema.safeParse(formInput(formData));
  if (!parsed.success) return validationFailure(parsed.error);

  const supabase = await createServerSupabaseClient();
  const result = await supabase.rpc("log_manual_sales_call", {
    p_lead_id: parsed.data.leadId,
    p_conversation_id: parsed.data.conversationId,
    p_direction: parsed.data.direction,
    p_status: parsed.data.status,
    p_started_at: indiaLocalToIso(parsed.data.startedAt),
    p_duration_seconds: parsed.data.durationSeconds,
    p_outcome: parsed.data.outcome,
  });
  if (result.error) return rpcFailure("log-call", result.error);

  revalidateSales();
  return success("Call outcome logged.");
}
