"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { CrudActionState } from "@/features/core-crud/types";
import { requireActiveSession } from "@/lib/auth/require-session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const assignmentSchema = z.object({
  bookingId: z.string().uuid(),
  chefProfileId: z.string().uuid(),
  agreedPayType: z.enum(["monthly", "daily", "hourly", "per_booking"]),
  agreedPayAmount: z.coerce.number().min(0).max(999999999),
  instructions: z
    .string()
    .trim()
    .max(5000)
    .transform((value) => (value === "" ? undefined : value)),
});

const optionalLocalDateTime = z
  .string()
  .trim()
  .refine(
    (value) => value === "" || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value),
    "Enter a valid date and time.",
  )
  .transform((value) => (value === "" ? undefined : value));

const attendanceReviewSchema = z
  .object({
    shiftId: z.string().uuid(),
    decision: z.enum(["approved", "corrected", "rejected"]),
    reason: z
      .string()
      .trim()
      .max(1000)
      .transform((value) => (value === "" ? undefined : value)),
    startedAt: optionalLocalDateTime,
    endedAt: optionalLocalDateTime,
    overtimeMinutes: z.coerce.number().int().min(0).max(1440).default(0),
  })
  .superRefine((value, context) => {
    if (value.decision === "corrected" && (!value.startedAt || !value.endedAt)) {
      context.addIssue({
        code: "custom",
        path: ["startedAt"],
        message: "Enter corrected start and end times.",
      });
    }
  });

const missedAttendanceSchema = z
  .object({
    subject: z.string().regex(/^(profile|temporary):[0-9a-f-]{36}$/i),
    bookingId: z
      .string()
      .trim()
      .transform((value) => (value === "" ? undefined : value))
      .pipe(z.string().uuid().optional()),
    shiftDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    startedAt: optionalLocalDateTime,
    endedAt: optionalLocalDateTime,
    status: z.enum(["pending_approval", "absent"]),
    overtimeMinutes: z.coerce.number().int().min(0).max(1440).default(0),
    reason: z.string().trim().min(3).max(1000),
  })
  .superRefine((value, context) => {
    if (value.status === "pending_approval" && (!value.startedAt || !value.endedAt)) {
      context.addIssue({
        code: "custom",
        path: ["startedAt"],
        message: "Enter start and end times for a missed shift.",
      });
    }
  });

function state(status: "success" | "error", message: string): CrudActionState {
  return {
    status,
    message,
    mutationId: crypto.randomUUID(),
  };
}

function safeError(error: unknown): CrudActionState {
  const message =
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
      ? error.message
      : "UNKNOWN";
  const messages: Record<string, string> = {
    BOOKING_NOT_ASSIGNABLE: "Only a confirmed booking can be assigned.",
    INVALID_CHEF_ASSIGNEE: "Choose an active Chef or Part-time Chef.",
    CHEF_ASSIGNMENT_CONFLICT: "That Chef is already assigned to another booking on this date.",
    ATTENDANCE_NOT_REVIEWABLE: "This shift is not ready for review.",
    CONFLICT_STALE_VERSION: "This shift changed. Refresh and try again.",
    PERMISSION_DENIED: "You do not have permission to make this change.",
  };

  return state(
    "error",
    messages[message] ?? "We could not save this change. Refresh and try again.",
  );
}

function indiaLocalDateTimeToIso(value: string | undefined): string | null {
  return value ? new Date(`${value}:00+05:30`).toISOString() : null;
}

function revalidateWorkforceManagement(): void {
  [
    "/hr/dashboard",
    "/hr/booking-assignment",
    "/hr/attendance",
    "/manager/dashboard",
    "/manager/attendance",
    "/director/dashboard",
    "/director/attendance",
    "/chef/dashboard",
    "/chef/jobs",
    "/chef/attendance",
    "/part-time-chef/dashboard",
    "/part-time-chef/jobs",
    "/part-time-chef/attendance",
  ].forEach((path) => revalidatePath(path));
}

export async function assignChefAction(
  _previousState: CrudActionState,
  formData: FormData,
): Promise<CrudActionState> {
  const session = await requireActiveSession();

  if (!["director", "manager", "hr"].includes(session.profile.role)) {
    return state("error", "You do not have permission to assign a Chef.");
  }

  const parsed = assignmentSchema.safeParse(Object.fromEntries(formData.entries()));

  if (!parsed.success) {
    return state("error", "Check the assignment details and try again.");
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("assign_booking_chef", {
    p_booking_id: parsed.data.bookingId,
    p_chef_profile_id: parsed.data.chefProfileId,
    p_agreed_pay_type: parsed.data.agreedPayType,
    p_agreed_pay_amount: parsed.data.agreedPayAmount,
    p_instructions: parsed.data.instructions ?? null,
  });

  if (error) {
    return safeError(error);
  }

  revalidateWorkforceManagement();
  return state("success", "Chef assigned to booking.");
}

export async function reviewAttendanceAction(
  _previousState: CrudActionState,
  formData: FormData,
): Promise<CrudActionState> {
  const session = await requireActiveSession();

  if (!["director", "manager", "hr"].includes(session.profile.role)) {
    return state("error", "You do not have permission to review attendance.");
  }

  const parsed = attendanceReviewSchema.safeParse(Object.fromEntries(formData.entries()));

  if (!parsed.success) {
    return state("error", "Check the attendance decision and try again.");
  }

  if (["corrected", "rejected"].includes(parsed.data.decision) && !parsed.data.reason) {
    return state("error", "Add a reason for a correction or rejection.");
  }

  const supabase = await createServerSupabaseClient();
  const { error } =
    parsed.data.decision === "corrected"
      ? await supabase.rpc("correct_attendance_shift", {
          p_shift_id: parsed.data.shiftId,
          p_started_at: indiaLocalDateTimeToIso(parsed.data.startedAt),
          p_ended_at: indiaLocalDateTimeToIso(parsed.data.endedAt),
          p_overtime_minutes: parsed.data.overtimeMinutes,
          p_reason: parsed.data.reason ?? null,
        })
      : await supabase.rpc("review_attendance_shift", {
          p_shift_id: parsed.data.shiftId,
          p_decision: parsed.data.decision,
          p_reason: parsed.data.reason ?? null,
        });

  if (error) {
    return safeError(error);
  }

  revalidateWorkforceManagement();
  return state("success", "Attendance decision saved.");
}

export async function bulkApproveAttendanceAction(
  _previousState: CrudActionState,
  formData: FormData,
): Promise<CrudActionState> {
  const session = await requireActiveSession();

  if (!["director", "manager", "hr"].includes(session.profile.role)) {
    return state("error", "You do not have permission to review attendance.");
  }

  const shiftIds = z.array(z.string().uuid()).safeParse(formData.getAll("shiftIds"));

  if (!shiftIds.success || shiftIds.data.length === 0 || shiftIds.data.length > 100) {
    return state("error", "Select at least one pending attendance record.");
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("bulk_approve_attendance_shifts", {
    p_shift_ids: shiftIds.data,
  });

  if (error) {
    return safeError(error);
  }

  revalidateWorkforceManagement();
  return state("success", `${Number(data ?? 0)} attendance records approved.`);
}

export async function recordMissedAttendanceAction(
  _previousState: CrudActionState,
  formData: FormData,
): Promise<CrudActionState> {
  const session = await requireActiveSession();

  if (!["director", "manager", "hr"].includes(session.profile.role)) {
    return state("error", "You do not have permission to record attendance.");
  }

  const parsed = missedAttendanceSchema.safeParse(Object.fromEntries(formData.entries()));

  if (!parsed.success) {
    return state("error", parsed.error.issues[0]?.message ?? "Check the attendance details.");
  }

  const [subjectType, subjectId] = parsed.data.subject.split(":");

  if (!subjectId) {
    return state("error", "Choose a worker.");
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("record_missed_attendance_shift", {
    p_profile_id: subjectType === "profile" ? subjectId : null,
    p_temporary_worker_id: subjectType === "temporary" ? subjectId : null,
    p_booking_id: parsed.data.bookingId ?? null,
    p_shift_date: parsed.data.shiftDate,
    p_started_at: indiaLocalDateTimeToIso(parsed.data.startedAt),
    p_ended_at: indiaLocalDateTimeToIso(parsed.data.endedAt),
    p_status: parsed.data.status,
    p_overtime_minutes: parsed.data.overtimeMinutes,
    p_reason: parsed.data.reason,
  });

  if (error) {
    return safeError(error);
  }

  revalidateWorkforceManagement();
  return state("success", "Attendance record created.");
}
