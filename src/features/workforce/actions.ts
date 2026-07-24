"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireActiveSession } from "@/lib/auth/require-session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import type { WorkforceActionState } from "./types";

const bookingSchema = z.object({
  bookingId: z.string().uuid(),
});

const endShiftSchema = z.object({
  shiftId: z.string().uuid(),
});

const jobStatusSchema = z.object({
  bookingId: z.string().uuid(),
  expectedVersion: z.coerce.number().int().positive(),
  toStatus: z.enum(["preparing", "service_completed"]),
});

function result(status: "success" | "error", message: string): WorkforceActionState {
  return {
    status,
    message,
    mutationId: crypto.randomUUID(),
  };
}

function safeDatabaseFailure(error: unknown): WorkforceActionState {
  const code =
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
      ? error.message
      : "UNKNOWN";

  const messages: Record<string, string> = {
    ATTENDANCE_ALREADY_OPEN: "You already have a shift in progress.",
    ATTENDANCE_NOT_ASSIGNED: "Attendance is available only for your assigned work date.",
    ATTENDANCE_NOT_OPEN: "This shift is no longer open.",
    INVALID_STATUS_TRANSITION: "This job status has already changed. Refresh and try again.",
    CONFLICT_STALE_VERSION: "This job changed in another session. Refresh and try again.",
    PERMISSION_DENIED: "You do not have permission to make this change.",
    AUTH_REQUIRED: "Your session has expired. Log in again.",
  };

  return result(
    "error",
    messages[code] ?? "We could not save this change. Refresh the page and try again.",
  );
}

async function requireWorker() {
  const session = await requireActiveSession();

  if (!["chef", "part_time_chef"].includes(session.profile.role)) {
    return null;
  }

  return session;
}

function revalidateWorkforce(): void {
  [
    "/chef/dashboard",
    "/chef/jobs",
    "/chef/attendance",
    "/part-time-chef/dashboard",
    "/part-time-chef/jobs",
    "/part-time-chef/attendance",
  ].forEach((path) => revalidatePath(path));
}

export async function startShiftAction(
  _previousState: WorkforceActionState,
  formData: FormData,
): Promise<WorkforceActionState> {
  if (!(await requireWorker())) {
    return result("error", "You do not have permission to start this shift.");
  }

  const parsed = bookingSchema.safeParse({
    bookingId: formData.get("bookingId"),
  });

  if (!parsed.success) {
    return result("error", "Choose a valid assigned booking.");
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("start_attendance_shift", {
    p_booking_id: parsed.data.bookingId,
  });

  if (error) {
    return safeDatabaseFailure(error);
  }

  revalidateWorkforce();
  return result("success", "Shift started.");
}

export async function endShiftAction(
  _previousState: WorkforceActionState,
  formData: FormData,
): Promise<WorkforceActionState> {
  if (!(await requireWorker())) {
    return result("error", "You do not have permission to end this shift.");
  }

  const parsed = endShiftSchema.safeParse({
    shiftId: formData.get("shiftId"),
  });

  if (!parsed.success) {
    return result("error", "The active shift could not be identified.");
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("end_attendance_shift", {
    p_shift_id: parsed.data.shiftId,
  });

  if (error) {
    return safeDatabaseFailure(error);
  }

  revalidateWorkforce();
  return result("success", "Attendance submitted for HR approval.");
}

export async function changeJobStatusAction(
  _previousState: WorkforceActionState,
  formData: FormData,
): Promise<WorkforceActionState> {
  if (!(await requireWorker())) {
    return result("error", "You do not have permission to update this job.");
  }

  const parsed = jobStatusSchema.safeParse({
    bookingId: formData.get("bookingId"),
    expectedVersion: formData.get("expectedVersion"),
    toStatus: formData.get("toStatus"),
  });

  if (!parsed.success) {
    return result("error", "The job update is invalid. Refresh and try again.");
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("change_booking_service_status", {
    p_booking_id: parsed.data.bookingId,
    p_expected_version: parsed.data.expectedVersion,
    p_to_status: parsed.data.toStatus,
    p_reason:
      parsed.data.toStatus === "preparing"
        ? "Assigned Chef started preparation"
        : "Assigned Chef completed service",
  });

  if (error) {
    return safeDatabaseFailure(error);
  }

  revalidateWorkforce();
  return result(
    "success",
    parsed.data.toStatus === "preparing" ? "Job moved to Preparing." : "Service marked completed.",
  );
}
