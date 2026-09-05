"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";

import type { CrudActionState } from "@/features/core-crud/types";
import { requireActiveSession } from "@/lib/auth/require-session";
import type { Role } from "@/lib/constants/roles";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import {
  salaryStructureSchema,
  adjustPayrollEntrySchema,
  generatePayrollSchema,
  lockPayrollSchema,
  markPayrollPaidSchema,
  payrollPeriodActionSchema,
  reversePayrollEntrySchema,
} from "./schemas";

function input(formData: FormData): Record<string, FormDataEntryValue> {
  return Object.fromEntries(formData.entries());
}

function failure(message: string, fieldErrors?: Record<string, string>): CrudActionState {
  return {
    status: "error",
    message,
    mutationId: crypto.randomUUID(),
    ...(fieldErrors ? { fieldErrors } : {}),
  };
}

function success(message: string): CrudActionState {
  return {
    status: "success",
    message,
    mutationId: crypto.randomUUID(),
  };
}

function validationFailure(error: z.ZodError): CrudActionState {
  const fieldErrors: Record<string, string> = {};

  error.issues.forEach((issue) => {
    const field = issue.path[0];

    if (typeof field === "string" && fieldErrors[field] === undefined) {
      fieldErrors[field] = issue.message;
    }
  });

  return failure("Check the highlighted payroll fields and try again.", fieldErrors);
}

function databaseMessage(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  return "UNKNOWN";
}

function databaseFailure(error: unknown): CrudActionState {
  const rawMessage = databaseMessage(error);
  const messages: ReadonlyArray<[string, string]> = [
    ["PAYROLL_FRANCHISE_REQUIRED", "Choose a franchise for this payroll."],
    ["PAYROLL_PERIOD_OVERLAP", "This date range overlaps an existing payroll period."],
    ["PAYROLL_PERIOD_INVALID", "Use a valid date range within one calendar month."],
    ["PAYROLL_PERIOD_NOT_EDITABLE", "This payroll is no longer editable."],
    ["PAYROLL_PERIOD_LOCKED", "This paid payroll period is permanently locked."],
    ["PAYROLL_STATUS_CONFLICT", "Payroll changed in another session. Refresh and try again."],
    ["PAYROLL_NEGATIVE_NET", "Deductions and advances cannot exceed total earnings."],
    ["PAYROLL_PAID_IMMUTABLE", "Paid payroll history cannot be edited."],
    ["PERMISSION_DENIED", "You do not have permission to perform this payroll action."],
    ["AUTH_REQUIRED", "Your session expired. Sign in and try again."],
    ["VALIDATION_FAILED", "Check the payroll values and try again."],
  ];
  const known = messages.find(([code]) => rawMessage.includes(code));

  if (known) {
    return failure(known[1]);
  }

  const requestId = crypto.randomUUID();
  console.error("[payroll]", {
    requestId,
    code:
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : "UNKNOWN",
  });

  return {
    ...failure("Payroll could not be updated. Refresh and try again."),
    requestId,
  };
}

function can(role: Role, allowed: readonly Role[]): boolean {
  return allowed.includes(role);
}

function revalidatePayroll(): void {
  [
    "/director/dashboard",
    "/director/payroll",
    "/franchise/dashboard",
    "/franchise/payroll",
    "/manager/dashboard",
    "/manager/payroll",
    "/hr/dashboard",
    "/hr/payroll",
    "/chef/dashboard",
    "/chef/earnings",
    "/part-time-chef/dashboard",
    "/part-time-chef/earnings",
  ].forEach((path) => revalidatePath(path));
}

export async function generatePayrollAction(
  _previousState: CrudActionState,
  formData: FormData,
): Promise<CrudActionState> {
  const session = await requireActiveSession();

  if (!can(session.profile.role, ["director", "hr"])) {
    return failure("Only HR or the Director can generate payroll.");
  }

  const parsed = generatePayrollSchema.safeParse(input(formData));

  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("generate_payroll_period", {
    p_period_start: parsed.data.periodStart,
    p_period_end: parsed.data.periodEnd,
    p_franchise_id: parsed.data.franchiseId || null,
  });

  if (error) {
    return databaseFailure(error);
  }

  revalidatePayroll();
  return success("Payroll draft generated from eligible workforce records.");
}

export async function adjustPayrollEntryAction(
  _previousState: CrudActionState,
  formData: FormData,
): Promise<CrudActionState> {
  const session = await requireActiveSession();

  if (!can(session.profile.role, ["director", "hr"])) {
    return failure("Only HR or the Director can correct a payroll draft.");
  }

  const parsed = adjustPayrollEntrySchema.safeParse(input(formData));

  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("adjust_payroll_entry", {
    p_payroll_entry_id: parsed.data.payrollEntryId,
    p_allowances: parsed.data.allowances,
    p_deductions: parsed.data.deductions,
    p_advances: parsed.data.advances,
    p_reason: parsed.data.reason,
  });

  if (error) {
    return databaseFailure(error);
  }

  revalidatePayroll();
  return success("Payroll correction saved with an audit reason.");
}

async function periodTransition(
  formData: FormData,
  allowedRoles: readonly Role[],
  rpc:
    | "prepare_payroll_period"
    | "review_payroll_period"
    | "approve_payroll_period"
    | "lock_payroll_period",
  successMessage: string,
): Promise<CrudActionState> {
  const session = await requireActiveSession();

  if (!can(session.profile.role, allowedRoles)) {
    return failure("You do not have permission for this payroll step.");
  }

  const parsed = payrollPeriodActionSchema.safeParse(input(formData));

  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc(rpc, {
    p_payroll_period_id: parsed.data.payrollPeriodId,
  });

  if (error) {
    return databaseFailure(error);
  }

  revalidatePayroll();
  return success(successMessage);
}

export async function preparePayrollAction(
  _previousState: CrudActionState,
  formData: FormData,
): Promise<CrudActionState> {
  return periodTransition(
    formData,
    ["director", "hr"],
    "prepare_payroll_period",
    "Payroll submitted for Manager review.",
  );
}

export async function reviewPayrollAction(
  _previousState: CrudActionState,
  formData: FormData,
): Promise<CrudActionState> {
  return periodTransition(
    formData,
    ["director", "franchise", "manager"],
    "review_payroll_period",
    "Payroll reviewed and sent for Director approval.",
  );
}

export async function approvePayrollAction(
  _previousState: CrudActionState,
  formData: FormData,
): Promise<CrudActionState> {
  return periodTransition(
    formData,
    ["director"],
    "approve_payroll_period",
    "Payroll approved for payment.",
  );
}

export async function lockPayrollAction(
  _previousState: CrudActionState,
  formData: FormData,
): Promise<CrudActionState> {
  const session = await requireActiveSession();

  if (session.profile.role !== "director") {
    return failure("Only the Director can lock a paid payroll period.");
  }

  const parsed = lockPayrollSchema.safeParse(input(formData));

  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("lock_payroll_period", {
    p_payroll_period_id: parsed.data.payrollPeriodId,
  });

  if (error) {
    return databaseFailure(error);
  }

  revalidatePayroll();
  return success("Paid payroll period locked permanently.");
}

export async function markPayrollPaidAction(
  _previousState: CrudActionState,
  formData: FormData,
): Promise<CrudActionState> {
  const session = await requireActiveSession();

  if (session.profile.role !== "director") {
    return failure("Only the Director can record payroll payment.");
  }

  const parsed = markPayrollPaidSchema.safeParse(input(formData));

  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("mark_payroll_paid", {
    p_payroll_period_id: parsed.data.payrollPeriodId,
    p_payment_reference: parsed.data.paymentReference,
  });

  if (error) {
    return databaseFailure(error);
  }

  revalidatePayroll();
  return success("Payroll payment recorded. Lock the period after final verification.");
}

export async function reversePayrollEntryAction(
  _previousState: CrudActionState,
  formData: FormData,
): Promise<CrudActionState> {
  const session = await requireActiveSession();

  if (session.profile.role !== "director") {
    return failure("Only the Director can reverse a paid payroll entry.");
  }

  const parsed = reversePayrollEntrySchema.safeParse(input(formData));

  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("reverse_payroll_entry", {
    p_payroll_entry_id: parsed.data.payrollEntryId,
    p_reason: parsed.data.reason,
  });

  if (error) {
    return databaseFailure(error);
  }

  revalidatePayroll();
  return success("Payroll entry reversed. The original paid record remains in history.");
}

export async function saveSalaryStructureAction(
  _previousState: CrudActionState,
  formData: FormData,
): Promise<CrudActionState> {
  const session = await requireActiveSession();
  if (!can(session.profile.role, ["director", "hr"]))
    return failure("Only HR or the Director can save salary structures.");
  const parsed = salaryStructureSchema.safeParse(input(formData));
  if (!parsed.success) return validationFailure(parsed.error);
  const { profileId, expectedVersion, ...values } = parsed.data;
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("save_payroll_salary_structure", {
    p_profile_id: profileId,
    p_values: values,
    p_expected_version: expectedVersion,
  });
  if (error) return databaseFailure(error);
  revalidatePayroll();
  return success("Salary structure saved. It will be used in future payroll drafts.");
}
