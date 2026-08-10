"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { CrudActionState } from "@/features/core-crud/types";
import { requireActiveSession } from "@/lib/auth/require-session";
import { APP_ERROR_MESSAGES } from "@/lib/errors";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const expenseReviewSchema = z
  .object({
    id: z.string().uuid(),
    expectedUpdatedAt: z.string().datetime({ offset: true }),
    status: z.enum(["verified", "approved", "rejected", "paid"]),
    reason: z
      .string()
      .trim()
      .max(1000)
      .transform((value) => (value === "" ? undefined : value)),
  })
  .superRefine((value, context) => {
    if (value.status === "rejected" && !value.reason) {
      context.addIssue({
        code: "custom",
        path: ["reason"],
        message: "Enter a rejection reason.",
      });
    }
  });

const leaveReviewSchema = z
  .object({
    id: z.string().uuid(),
    expectedUpdatedAt: z.string().datetime({ offset: true }),
    status: z.enum(["approved", "rejected"]),
    reviewNote: z
      .string()
      .trim()
      .max(1000)
      .transform((value) => (value === "" ? undefined : value)),
  })
  .superRefine((value, context) => {
    if (value.status === "rejected" && !value.reviewNote) {
      context.addIssue({
        code: "custom",
        path: ["reviewNote"],
        message: "Enter a review note.",
      });
    }
  });

function state(status: "success" | "error", message: string): CrudActionState {
  return { status, message, mutationId: crypto.randomUUID() };
}

function safeFailure(error: unknown): CrudActionState {
  const code =
    typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
      ? error.code
      : "";
  const message =
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
      ? error.message
      : "";

  if (code === "42501" || message === "PERMISSION_DENIED") {
    return state("error", APP_ERROR_MESSAGES.PERMISSION_DENIED);
  }

  if (code === "40001" || message === "CONFLICT_STALE_VERSION") {
    return state("error", APP_ERROR_MESSAGES.CONFLICT_STALE_VERSION);
  }

  const safeMessages: Record<string, string> = {
    INVALID_EXPENSE_TRANSITION: "This expense is no longer available for that decision.",
    INVALID_LEAVE_TRANSITION: "This leave request has already been decided.",
    REJECTION_REASON_REQUIRED: "Enter a rejection reason.",
    REVIEW_NOTE_REQUIRED: "Enter a review note.",
  };

  return state(
    "error",
    safeMessages[message] ?? "The decision could not be saved. Refresh and try again.",
  );
}

function revalidateReviews(): void {
  [
    "/director/expenses",
    "/franchise/expenses",
    "/manager/expenses",
    "/hr/expenses",
    "/director/leave",
    "/franchise/leave",
    "/manager/leave",
    "/hr/leave",
    "/sales-manager/leave",
    "/chef/expenses",
    "/part-time-chef/expenses",
    "/sales/leave",
    "/chef/leave",
    "/part-time-chef/leave",
  ].forEach((path) => revalidatePath(path));
}

export async function reviewExpenseClaimAction(
  _previousState: CrudActionState,
  formData: FormData,
): Promise<CrudActionState> {
  await requireActiveSession();
  const parsed = expenseReviewSchema.safeParse(Object.fromEntries(formData.entries()));

  if (!parsed.success) {
    return state("error", parsed.error.issues[0]?.message ?? APP_ERROR_MESSAGES.VALIDATION_FAILED);
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("review_expense_claim", {
    p_expense_id: parsed.data.id,
    p_status: parsed.data.status,
    p_reason: parsed.data.reason ?? null,
    p_expected_updated_at: parsed.data.expectedUpdatedAt,
  });

  if (error) {
    return safeFailure(error);
  }

  revalidateReviews();
  return state("success", `Expense marked ${parsed.data.status}.`);
}

export async function reviewLeaveRequestAction(
  _previousState: CrudActionState,
  formData: FormData,
): Promise<CrudActionState> {
  await requireActiveSession();
  const parsed = leaveReviewSchema.safeParse(Object.fromEntries(formData.entries()));

  if (!parsed.success) {
    return state("error", parsed.error.issues[0]?.message ?? APP_ERROR_MESSAGES.VALIDATION_FAILED);
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("review_leave_request", {
    p_leave_request_id: parsed.data.id,
    p_status: parsed.data.status,
    p_review_note: parsed.data.reviewNote ?? null,
    p_expected_updated_at: parsed.data.expectedUpdatedAt,
  });

  if (error) {
    return safeFailure(error);
  }

  revalidateReviews();
  return state("success", `Leave request ${parsed.data.status}.`);
}
