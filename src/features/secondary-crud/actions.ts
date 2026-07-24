"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import type { z } from "zod";

import type { CrudActionState } from "@/features/core-crud/types";
import { normalizeIndianPhone } from "@/lib/auth/phone";
import { requireActiveSession } from "@/lib/auth/require-session";
import type { AuthenticatedSession } from "@/lib/auth/types";
import type { Role } from "@/lib/constants/roles";
import { APP_ERROR_MESSAGES } from "@/lib/errors";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import {
  assignTemporaryWorkerSchema,
  createMeetingSchema,
  createTemporaryWorkerSchema,
  deleteMeetingSchema,
  updateMeetingSchema,
  updateMeetingStatusSchema,
  updateTemporaryWorkerSchema,
  updateTemporaryWorkerStatusSchema,
} from "./schemas";

const MEETING_CREATOR_ROLES: readonly Role[] = ["director", "manager", "hr", "sales_manager"];
const TEMPORARY_WORKER_ADMIN_ROLES: readonly Role[] = ["director", "manager", "hr"];

const MEETING_PATHS = [
  "/director/meetings",
  "/manager/meetings",
  "/hr/meetings",
  "/sales-manager/meetings",
  "/sales/meetings",
  "/chef/meetings",
  "/part-time-chef/meetings",
  "/director/dashboard",
  "/manager/dashboard",
  "/hr/dashboard",
  "/sales-manager/dashboard",
] as const;

const TEMPORARY_WORKER_PATHS = [
  "/hr/temporary-workers",
  "/hr/dashboard",
  "/director/workforce",
  "/manager/workforce",
  "/director/dashboard",
  "/manager/dashboard",
] as const;

function revalidatePaths(paths: readonly string[]): void {
  paths.forEach((path) => revalidatePath(path));
}

function inputFromFormData(formData: FormData): Record<string, FormDataEntryValue> {
  return Object.fromEntries(formData.entries());
}

function meetingInputFromFormData(
  formData: FormData,
): Record<string, FormDataEntryValue | FormDataEntryValue[]> {
  return {
    ...inputFromFormData(formData),
    attendeeProfileIds: formData.getAll("attendeeProfileIds"),
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

  return {
    status: "error",
    message: APP_ERROR_MESSAGES.VALIDATION_FAILED,
    mutationId: crypto.randomUUID(),
    fieldErrors,
  };
}

function fieldFailure(field: string, fieldMessage: string): CrudActionState {
  return {
    status: "error",
    message: APP_ERROR_MESSAGES.VALIDATION_FAILED,
    mutationId: crypto.randomUUID(),
    fieldErrors: { [field]: fieldMessage },
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

function databaseFailure(operation: string, error: unknown): CrudActionState {
  const requestId = crypto.randomUUID();
  const code = databaseErrorCode(error);

  console.error("[secondary-crud]", { operation, requestId, code });

  if (code === "42501") {
    return failure(APP_ERROR_MESSAGES.PERMISSION_DENIED);
  }

  return failure("We could not save your changes. Refresh the page and try again.", requestId);
}

function staleFailure(): CrudActionState {
  return failure(APP_ERROR_MESSAGES.CONFLICT_STALE_VERSION);
}

function localDateTimeToIso(value: string): string {
  return new Date(`${value}:00+05:30`).toISOString();
}

function canManageMeeting(role: Role, viewerId: string, creatorId: string): boolean {
  return role === "director" || role === "manager" || viewerId === creatorId;
}

function isAllowedMeetingAttendee(
  session: AuthenticatedSession,
  profile: { id: string; role: unknown },
): boolean {
  if (session.profile.role === "director" || session.profile.role === "manager") {
    return true;
  }

  if (session.profile.role === "hr") {
    return (
      profile.id === session.userId || profile.role === "chef" || profile.role === "part_time_chef"
    );
  }

  if (session.profile.role === "sales_manager") {
    return profile.id === session.userId || profile.role === "sales";
  }

  return false;
}

async function validateMeetingAttendees(
  supabase: SupabaseClient,
  session: AuthenticatedSession,
  profileIds: string[],
): Promise<{ valid: boolean; error: unknown | null }> {
  if (profileIds.length === 0) {
    return { valid: true, error: null };
  }

  const result = await supabase
    .from("profiles")
    .select("id,role")
    .in("id", profileIds)
    .eq("account_status", "active")
    .is("deleted_at", null);

  if (result.error) {
    return { valid: false, error: result.error };
  }

  const allowedIds = new Set(
    (result.data ?? [])
      .filter(
        (profile): profile is { id: string; role: unknown } =>
          typeof profile === "object" &&
          profile !== null &&
          typeof profile.id === "string" &&
          isAllowedMeetingAttendee(session, profile),
      )
      .map((profile) => profile.id),
  );

  return {
    valid: profileIds.every((profileId) => allowedIds.has(profileId)),
    error: null,
  };
}

async function findEditableMeeting(
  supabase: SupabaseClient,
  session: AuthenticatedSession,
  id: string,
): Promise<
  | { ok: true; meeting: { createdByProfileId: string; updatedAt: string } }
  | { ok: false; state: CrudActionState }
> {
  const result = await supabase
    .from("meetings")
    .select("created_by_profile_id,updated_at")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();

  if (result.error) {
    return { ok: false, state: databaseFailure("load-editable-meeting", result.error) };
  }

  if (
    !result.data ||
    typeof result.data.created_by_profile_id !== "string" ||
    typeof result.data.updated_at !== "string"
  ) {
    return { ok: false, state: failure(APP_ERROR_MESSAGES.PERMISSION_DENIED) };
  }

  if (!canManageMeeting(session.profile.role, session.userId, result.data.created_by_profile_id)) {
    return { ok: false, state: failure(APP_ERROR_MESSAGES.PERMISSION_DENIED) };
  }

  return {
    ok: true,
    meeting: {
      createdByProfileId: result.data.created_by_profile_id,
      updatedAt: result.data.updated_at,
    },
  };
}

export async function createMeetingAction(
  _previousState: CrudActionState,
  formData: FormData,
): Promise<CrudActionState> {
  const session = await requireActiveSession();

  if (!MEETING_CREATOR_ROLES.includes(session.profile.role)) {
    return failure(APP_ERROR_MESSAGES.PERMISSION_DENIED);
  }

  const parsed = createMeetingSchema.safeParse(meetingInputFromFormData(formData));

  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  const supabase = await createServerSupabaseClient();
  const attendeeValidation = await validateMeetingAttendees(
    supabase,
    session,
    parsed.data.attendeeProfileIds,
  );

  if (attendeeValidation.error) {
    return databaseFailure("validate-meeting-attendees", attendeeValidation.error);
  }

  if (!attendeeValidation.valid) {
    return fieldFailure(
      "attendeeProfileIds",
      "One or more attendees are outside your permitted team.",
    );
  }

  const meetingResult = await supabase
    .from("meetings")
    .insert({
      organization_id: session.profile.organization_id,
      title: parsed.data.title,
      reason: parsed.data.reason ?? null,
      starts_at: localDateTimeToIso(parsed.data.startsAt),
      ends_at: localDateTimeToIso(parsed.data.endsAt),
      location: parsed.data.location ?? null,
      meeting_url: parsed.data.meetingUrl ?? null,
      status: "scheduled",
      created_by_profile_id: session.userId,
    })
    .select("id")
    .single();

  if (meetingResult.error) {
    return databaseFailure("create-meeting", meetingResult.error);
  }

  if (parsed.data.attendeeProfileIds.length > 0) {
    const attendeeResult = await supabase.from("meeting_attendees").insert(
      parsed.data.attendeeProfileIds.map((profileId) => ({
        organization_id: session.profile.organization_id,
        meeting_id: meetingResult.data.id,
        profile_id: profileId,
        attendance_status: "invited",
      })),
    );

    if (attendeeResult.error) {
      await supabase
        .from("meetings")
        .update({ deleted_at: new Date().toISOString(), status: "cancelled" })
        .eq("id", meetingResult.data.id);
      return databaseFailure("create-meeting-attendees", attendeeResult.error);
    }
  }

  revalidatePaths(MEETING_PATHS);
  return success("Meeting scheduled.");
}

export async function updateMeetingAction(
  _previousState: CrudActionState,
  formData: FormData,
): Promise<CrudActionState> {
  const session = await requireActiveSession();
  const parsed = updateMeetingSchema.safeParse(meetingInputFromFormData(formData));

  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  const supabase = await createServerSupabaseClient();
  const editableMeeting = await findEditableMeeting(supabase, session, parsed.data.id);

  if (!editableMeeting.ok) {
    return editableMeeting.state;
  }

  if (editableMeeting.meeting.updatedAt !== parsed.data.expectedUpdatedAt) {
    return staleFailure();
  }

  const attendeeValidation = await validateMeetingAttendees(
    supabase,
    session,
    parsed.data.attendeeProfileIds,
  );

  if (attendeeValidation.error) {
    return databaseFailure("validate-meeting-attendees", attendeeValidation.error);
  }

  if (!attendeeValidation.valid) {
    return fieldFailure(
      "attendeeProfileIds",
      "One or more attendees are outside your permitted team.",
    );
  }

  const currentAttendeeResult = await supabase
    .from("meeting_attendees")
    .select("profile_id")
    .eq("meeting_id", parsed.data.id);

  if (currentAttendeeResult.error) {
    return databaseFailure("load-current-meeting-attendees", currentAttendeeResult.error);
  }

  const currentIds = new Set(
    (currentAttendeeResult.data ?? [])
      .map((attendee) => attendee.profile_id)
      .filter((profileId): profileId is string => typeof profileId === "string"),
  );
  const requestedIds = new Set(parsed.data.attendeeProfileIds);
  const idsToAdd = parsed.data.attendeeProfileIds.filter((profileId) => !currentIds.has(profileId));
  const idsToRemove = [...currentIds].filter((profileId) => !requestedIds.has(profileId));

  if (idsToAdd.length > 0) {
    const addResult = await supabase.from("meeting_attendees").insert(
      idsToAdd.map((profileId) => ({
        organization_id: session.profile.organization_id,
        meeting_id: parsed.data.id,
        profile_id: profileId,
        attendance_status: "invited",
      })),
    );

    if (addResult.error) {
      return databaseFailure("add-meeting-attendees", addResult.error);
    }
  }

  const updateResult = await supabase
    .from("meetings")
    .update({
      title: parsed.data.title,
      reason: parsed.data.reason ?? null,
      starts_at: localDateTimeToIso(parsed.data.startsAt),
      ends_at: localDateTimeToIso(parsed.data.endsAt),
      location: parsed.data.location ?? null,
      meeting_url: parsed.data.meetingUrl ?? null,
    })
    .eq("id", parsed.data.id)
    .eq("updated_at", parsed.data.expectedUpdatedAt)
    .select("id")
    .maybeSingle();

  if (updateResult.error) {
    if (idsToAdd.length > 0) {
      await supabase
        .from("meeting_attendees")
        .delete()
        .eq("meeting_id", parsed.data.id)
        .in("profile_id", idsToAdd);
    }
    return databaseFailure("update-meeting", updateResult.error);
  }

  if (!updateResult.data) {
    if (idsToAdd.length > 0) {
      await supabase
        .from("meeting_attendees")
        .delete()
        .eq("meeting_id", parsed.data.id)
        .in("profile_id", idsToAdd);
    }
    return staleFailure();
  }

  if (idsToRemove.length > 0) {
    const removeResult = await supabase
      .from("meeting_attendees")
      .delete()
      .eq("meeting_id", parsed.data.id)
      .in("profile_id", idsToRemove);

    if (removeResult.error) {
      return databaseFailure("remove-meeting-attendees", removeResult.error);
    }
  }

  revalidatePaths(MEETING_PATHS);
  return success("Meeting updated.");
}

export async function updateMeetingStatusAction(
  _previousState: CrudActionState,
  formData: FormData,
): Promise<CrudActionState> {
  const session = await requireActiveSession();
  const parsed = updateMeetingStatusSchema.safeParse(inputFromFormData(formData));

  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  const supabase = await createServerSupabaseClient();
  const editableMeeting = await findEditableMeeting(supabase, session, parsed.data.id);

  if (!editableMeeting.ok) {
    return editableMeeting.state;
  }

  if (editableMeeting.meeting.updatedAt !== parsed.data.expectedUpdatedAt) {
    return staleFailure();
  }

  const result = await supabase
    .from("meetings")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.id)
    .eq("updated_at", parsed.data.expectedUpdatedAt)
    .select("id")
    .maybeSingle();

  if (result.error) {
    return databaseFailure("update-meeting-status", result.error);
  }

  if (!result.data) {
    return staleFailure();
  }

  revalidatePaths(MEETING_PATHS);
  return success(`Meeting marked ${parsed.data.status.replace("_", " ")}.`);
}

export async function deleteMeetingAction(
  _previousState: CrudActionState,
  formData: FormData,
): Promise<CrudActionState> {
  const session = await requireActiveSession();
  const parsed = deleteMeetingSchema.safeParse(inputFromFormData(formData));

  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  const supabase = await createServerSupabaseClient();
  const editableMeeting = await findEditableMeeting(supabase, session, parsed.data.id);

  if (!editableMeeting.ok) {
    return editableMeeting.state;
  }

  if (editableMeeting.meeting.updatedAt !== parsed.data.expectedUpdatedAt) {
    return staleFailure();
  }

  const result = await supabase
    .from("meetings")
    .update({
      deleted_at: new Date().toISOString(),
      status: "cancelled",
    })
    .eq("id", parsed.data.id)
    .eq("updated_at", parsed.data.expectedUpdatedAt)
    .select("id")
    .maybeSingle();

  if (result.error) {
    return databaseFailure("delete-meeting", result.error);
  }

  if (!result.data) {
    return staleFailure();
  }

  revalidatePaths(MEETING_PATHS);
  return success("Meeting deleted.");
}

function normalizeOptionalPhone(
  value: string | undefined,
): { ok: true; phone: string | null } | { ok: false; state: CrudActionState } {
  if (!value) {
    return { ok: true, phone: null };
  }

  try {
    return { ok: true, phone: normalizeIndianPhone(value) };
  } catch {
    return {
      ok: false,
      state: fieldFailure("phone", "Enter a valid 10-digit Indian mobile number."),
    };
  }
}

export async function createTemporaryWorkerAction(
  _previousState: CrudActionState,
  formData: FormData,
): Promise<CrudActionState> {
  const session = await requireActiveSession();

  if (!TEMPORARY_WORKER_ADMIN_ROLES.includes(session.profile.role)) {
    return failure(APP_ERROR_MESSAGES.PERMISSION_DENIED);
  }

  const parsed = createTemporaryWorkerSchema.safeParse(inputFromFormData(formData));

  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  const phone = normalizeOptionalPhone(parsed.data.phone);

  if (!phone.ok) {
    return phone.state;
  }

  const supabase = await createServerSupabaseClient();
  const result = await supabase.from("temporary_workers").insert({
    organization_id: session.profile.organization_id,
    full_name: parsed.data.fullName,
    phone_e164: phone.phone,
    worker_type: parsed.data.workerType,
    payment_type: parsed.data.paymentType,
    payment_amount: parsed.data.paymentAmount,
    notes: parsed.data.notes ?? null,
    is_active: true,
    created_by_profile_id: session.userId,
  });

  if (result.error) {
    return databaseFailure("create-temporary-worker", result.error);
  }

  revalidatePaths(TEMPORARY_WORKER_PATHS);
  return success("Temporary worker added.");
}

export async function updateTemporaryWorkerAction(
  _previousState: CrudActionState,
  formData: FormData,
): Promise<CrudActionState> {
  const session = await requireActiveSession();

  if (!TEMPORARY_WORKER_ADMIN_ROLES.includes(session.profile.role)) {
    return failure(APP_ERROR_MESSAGES.PERMISSION_DENIED);
  }

  const parsed = updateTemporaryWorkerSchema.safeParse(inputFromFormData(formData));

  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  const phone = normalizeOptionalPhone(parsed.data.phone);

  if (!phone.ok) {
    return phone.state;
  }

  const supabase = await createServerSupabaseClient();
  const result = await supabase
    .from("temporary_workers")
    .update({
      full_name: parsed.data.fullName,
      phone_e164: phone.phone,
      worker_type: parsed.data.workerType,
      payment_type: parsed.data.paymentType,
      payment_amount: parsed.data.paymentAmount,
      notes: parsed.data.notes ?? null,
    })
    .eq("id", parsed.data.id)
    .eq("updated_at", parsed.data.expectedUpdatedAt)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();

  if (result.error) {
    return databaseFailure("update-temporary-worker", result.error);
  }

  if (!result.data) {
    return staleFailure();
  }

  revalidatePaths(TEMPORARY_WORKER_PATHS);
  return success("Temporary worker updated.");
}

export async function updateTemporaryWorkerStatusAction(
  _previousState: CrudActionState,
  formData: FormData,
): Promise<CrudActionState> {
  const session = await requireActiveSession();

  if (!TEMPORARY_WORKER_ADMIN_ROLES.includes(session.profile.role)) {
    return failure(APP_ERROR_MESSAGES.PERMISSION_DENIED);
  }

  const parsed = updateTemporaryWorkerStatusSchema.safeParse(inputFromFormData(formData));

  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  const supabase = await createServerSupabaseClient();
  const result = await supabase
    .from("temporary_workers")
    .update({ is_active: parsed.data.isActive })
    .eq("id", parsed.data.id)
    .eq("updated_at", parsed.data.expectedUpdatedAt)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();

  if (result.error) {
    return databaseFailure("update-temporary-worker-status", result.error);
  }

  if (!result.data) {
    return staleFailure();
  }

  revalidatePaths(TEMPORARY_WORKER_PATHS);
  return success(
    parsed.data.isActive ? "Temporary worker activated." : "Temporary worker deactivated.",
  );
}

export async function assignTemporaryWorkerAction(
  _previousState: CrudActionState,
  formData: FormData,
): Promise<CrudActionState> {
  const session = await requireActiveSession();

  if (!TEMPORARY_WORKER_ADMIN_ROLES.includes(session.profile.role)) {
    return failure(APP_ERROR_MESSAGES.PERMISSION_DENIED);
  }

  const parsed = assignTemporaryWorkerSchema.safeParse(inputFromFormData(formData));

  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("assign_temporary_worker_to_booking", {
    p_temporary_worker_id: parsed.data.temporaryWorkerId,
    p_booking_id: parsed.data.bookingId,
    p_work_date: parsed.data.workDate,
    p_reporting_time: parsed.data.reportingTime ?? null,
    p_agreed_payment: parsed.data.agreedPayment,
    p_notes: parsed.data.notes ?? null,
  });

  if (error) {
    const message =
      typeof error.message === "string"
        ? ({
            WORK_DATE_MUST_MATCH_BOOKING: "Work date must match the booking event date.",
            INVALID_TEMPORARY_WORKER: "Choose an active temporary worker.",
            INVALID_BOOKING: "Choose an active booking.",
          }[error.message] ?? null)
        : null;

    if (message) {
      return failure(message);
    }

    if (error.code === "23505") {
      return failure("This worker is already assigned on that date.");
    }

    return databaseFailure("assign-temporary-worker", error);
  }

  revalidatePaths(TEMPORARY_WORKER_PATHS);
  revalidatePath("/hr/attendance");
  return success("Temporary worker assigned to booking.");
}
