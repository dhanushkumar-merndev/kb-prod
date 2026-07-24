import "server-only";

import { z } from "zod";

import { requireActiveSession } from "@/lib/auth/require-session";
import { ROLES, type Role } from "@/lib/constants/roles";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import {
  MEETING_ATTENDANCE_STATUSES,
  MEETING_STATUSES,
  TEMPORARY_WORKER_PAYMENT_TYPES,
  TEMPORARY_WORKER_TYPES,
  type MeetingAttendeeRecord,
  type MeetingCrudData,
  type MeetingDirectoryProfile,
  type MeetingRecord,
  type TemporaryWorkerCrudData,
  type TemporaryWorkerRecord,
} from "./types";
import type { CrudLoadState } from "@/features/core-crud/types";

const MEETING_CREATOR_ROLES: readonly Role[] = ["director", "manager", "hr", "sales_manager"];
const TEMPORARY_WORKER_ADMIN_ROLES: readonly Role[] = ["director", "manager", "hr"];

const meetingRowSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  reason: z.string().nullable(),
  starts_at: z.string(),
  ends_at: z.string(),
  location: z.string().nullable(),
  meeting_url: z.string().nullable(),
  status: z.enum(MEETING_STATUSES),
  created_by_profile_id: z.string().uuid(),
  created_at: z.string(),
  updated_at: z.string(),
});

const attendeeRowSchema = z.object({
  meeting_id: z.string().uuid(),
  profile_id: z.string().uuid(),
  attendance_status: z.enum(MEETING_ATTENDANCE_STATUSES),
});

const directoryRowSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string(),
  role: z.enum(ROLES),
});

const moneySchema = z.union([z.string(), z.number()]).transform((value) => String(value));

const temporaryWorkerRowSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string(),
  phone_e164: z.string().nullable(),
  worker_type: z.enum(TEMPORARY_WORKER_TYPES),
  payment_type: z.enum(TEMPORARY_WORKER_PAYMENT_TYPES),
  payment_amount: moneySchema,
  notes: z.string().nullable(),
  is_active: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
});

const temporaryWorkerBookingSchema = z.object({
  id: z.string().uuid(),
  booking_code: z.string(),
  event_date: z.string(),
});

const temporaryWorkerAssignmentSchema = z.object({
  id: z.string().uuid(),
  temporary_worker_id: z.string().uuid(),
  booking_id: z.string().uuid(),
  work_date: z.string(),
  reporting_time: z.string().nullable(),
  agreed_payment: moneySchema,
  notes: z.string().nullable(),
  created_at: z.string(),
});

function loadFailure(operation: string, error: unknown): CrudLoadState<never> {
  const requestId = crypto.randomUUID();
  const code =
    typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
      ? error.code
      : "UNKNOWN";

  console.error("[secondary-crud]", { operation, requestId, code });

  return {
    ok: false,
    message: "We could not load this information. Refresh the page and try again.",
    requestId,
  };
}

function safeMeetingUrl(value: string | null): string | null {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? value : null;
  } catch {
    return null;
  }
}

function toMeetingRecord(
  row: z.infer<typeof meetingRowSchema>,
  attendees: MeetingAttendeeRecord[],
): MeetingRecord {
  return {
    id: row.id,
    title: row.title,
    reason: row.reason,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    location: row.location,
    meetingUrl: safeMeetingUrl(row.meeting_url),
    status: row.status,
    createdByProfileId: row.created_by_profile_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    attendees,
  };
}

function toDirectoryProfile(row: z.infer<typeof directoryRowSchema>): MeetingDirectoryProfile {
  return {
    id: row.id,
    fullName: row.full_name,
    role: row.role,
  };
}

function toTemporaryWorker(row: z.infer<typeof temporaryWorkerRowSchema>): TemporaryWorkerRecord {
  return {
    id: row.id,
    fullName: row.full_name,
    phoneE164: row.phone_e164,
    workerType: row.worker_type,
    paymentType: row.payment_type,
    paymentAmount: row.payment_amount,
    notes: row.notes,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function loadMeetingCrudData(): Promise<CrudLoadState<MeetingCrudData>> {
  const session = await requireActiveSession();
  const supabase = await createServerSupabaseClient();
  const canCreate = MEETING_CREATOR_ROLES.includes(session.profile.role);

  const meetingResult = await supabase
    .from("meetings")
    .select(
      "id,title,reason,starts_at,ends_at,location,meeting_url,status,created_by_profile_id,created_at,updated_at",
    )
    .is("deleted_at", null)
    .eq("status", "scheduled")
    .gte("ends_at", new Date().toISOString())
    .order("starts_at", { ascending: true })
    .limit(100);

  if (meetingResult.error) {
    return loadFailure("load-meetings", meetingResult.error);
  }

  try {
    const meetingRows = z.array(meetingRowSchema).parse(meetingResult.data ?? []);
    const meetingIds = meetingRows.map((meeting) => meeting.id);

    const [attendeeResult, directoryResult] = await Promise.all([
      meetingIds.length > 0
        ? supabase
            .from("meeting_attendees")
            .select("meeting_id,profile_id,attendance_status")
            .in("meeting_id", meetingIds)
        : Promise.resolve({ data: [], error: null }),
      canCreate
        ? supabase
            .from("profiles")
            .select("id,full_name,role")
            .eq("account_status", "active")
            .is("deleted_at", null)
            .order("full_name", { ascending: true })
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (attendeeResult.error) {
      return loadFailure("load-meeting-attendees", attendeeResult.error);
    }

    if (directoryResult.error) {
      return loadFailure("load-meeting-directory", directoryResult.error);
    }

    const attendeeRows = z.array(attendeeRowSchema).parse(attendeeResult.data ?? []);
    const attendeeMap = new Map<string, MeetingAttendeeRecord[]>();

    attendeeRows.forEach((attendee) => {
      const attendees = attendeeMap.get(attendee.meeting_id) ?? [];
      attendees.push({
        profileId: attendee.profile_id,
        attendanceStatus: attendee.attendance_status,
      });
      attendeeMap.set(attendee.meeting_id, attendees);
    });

    return {
      ok: true,
      data: {
        viewerId: session.userId,
        viewerRole: session.profile.role,
        canCreate,
        meetings: meetingRows.map((meeting) =>
          toMeetingRecord(meeting, attendeeMap.get(meeting.id) ?? []),
        ),
        directory: z
          .array(directoryRowSchema)
          .parse(directoryResult.data ?? [])
          .map(toDirectoryProfile),
      },
    };
  } catch (error) {
    return loadFailure("parse-meetings", error);
  }
}

export async function loadTemporaryWorkerCrudData(): Promise<
  CrudLoadState<TemporaryWorkerCrudData>
> {
  const session = await requireActiveSession();

  if (!TEMPORARY_WORKER_ADMIN_ROLES.includes(session.profile.role)) {
    return {
      ok: false,
      message: "You do not have permission to view temporary workers.",
      requestId: crypto.randomUUID(),
    };
  }

  const supabase = await createServerSupabaseClient();
  const [result, bookingResult, assignmentResult] = await Promise.all([
    supabase
      .from("temporary_workers")
      .select(
        "id,full_name,phone_e164,worker_type,payment_type,payment_amount,notes,is_active,created_at,updated_at",
      )
      .is("deleted_at", null)
      .order("is_active", { ascending: false })
      .order("full_name", { ascending: true })
      .limit(200),
    supabase
      .from("bookings")
      .select("id,booking_code,event_date")
      .is("deleted_at", null)
      .neq("service_status", "cancelled")
      .order("event_date", { ascending: false })
      .limit(500),
    supabase
      .from("temporary_worker_assignments")
      .select(
        "id,temporary_worker_id,booking_id,work_date,reporting_time,agreed_payment,notes,created_at",
      )
      .order("work_date", { ascending: false })
      .limit(500),
  ]);

  if (result.error) {
    return loadFailure("load-temporary-workers", result.error);
  }

  if (bookingResult.error) {
    return loadFailure("load-temporary-worker-bookings", bookingResult.error);
  }

  if (assignmentResult.error) {
    return loadFailure("load-temporary-worker-assignments", assignmentResult.error);
  }

  try {
    return {
      ok: true,
      data: {
        viewerRole: session.profile.role,
        workers: z
          .array(temporaryWorkerRowSchema)
          .parse(result.data ?? [])
          .map(toTemporaryWorker),
        bookings: z
          .array(temporaryWorkerBookingSchema)
          .parse(bookingResult.data ?? [])
          .map((booking) => ({
            id: booking.id,
            bookingCode: booking.booking_code,
            eventDate: booking.event_date,
          })),
        assignments: z
          .array(temporaryWorkerAssignmentSchema)
          .parse(assignmentResult.data ?? [])
          .map((assignment) => ({
            id: assignment.id,
            temporaryWorkerId: assignment.temporary_worker_id,
            bookingId: assignment.booking_id,
            workDate: assignment.work_date,
            reportingTime: assignment.reporting_time,
            agreedPayment: assignment.agreed_payment,
            notes: assignment.notes,
            createdAt: assignment.created_at,
          })),
      },
    };
  } catch (error) {
    return loadFailure("parse-temporary-workers", error);
  }
}
