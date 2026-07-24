import "server-only";

import { z } from "zod";

import { requireRoleSession } from "@/lib/auth/require-role-session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import type { AttendanceShift, WorkforceJob, WorkforceSelfServiceData } from "./types";

const jobStatusSchema = z.enum([
  "pending",
  "confirmed",
  "chef_assigned",
  "preparing",
  "service_completed",
  "fully_completed",
  "cancelled",
]);

const jobRowSchema = z.object({
  booking_id: z.string().uuid(),
  booking_code: z.string(),
  event_type: z.string(),
  event_date: z.string(),
  reporting_time: z.string().nullable(),
  venue: z.string(),
  guest_count: z.number().int(),
  menu: z.string(),
  instructions: z.string().nullable(),
  service_status: jobStatusSchema,
  version: z.number().int().positive(),
  agreed_pay_amount: z.union([z.string(), z.number()]).nullable(),
});

const shiftRowSchema = z.object({
  id: z.string().uuid(),
  booking_id: z.string().uuid().nullable(),
  shift_date: z.string(),
  started_at: z.string(),
  ended_at: z.string().nullable(),
  status: z.enum(["working", "pending_approval", "approved", "corrected", "rejected", "absent"]),
});

function toJob(row: z.infer<typeof jobRowSchema>): WorkforceJob {
  return {
    bookingId: row.booking_id,
    bookingCode: row.booking_code,
    eventType: row.event_type,
    eventDate: row.event_date,
    reportingTime: row.reporting_time,
    venue: row.venue,
    guestCount: row.guest_count,
    menu: row.menu,
    instructions: row.instructions,
    serviceStatus: row.service_status,
    version: row.version,
    agreedPayAmount: row.agreed_pay_amount === null ? null : String(row.agreed_pay_amount),
  };
}

function toShift(row: z.infer<typeof shiftRowSchema>): AttendanceShift {
  return {
    id: row.id,
    bookingId: row.booking_id,
    shiftDate: row.shift_date,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    status: row.status,
  };
}

export type WorkforceLoadResult =
  { ok: true; data: WorkforceSelfServiceData } | { ok: false; message: string };

export async function loadWorkforceSelfService(): Promise<WorkforceLoadResult> {
  const session = await requireRoleSession(["chef", "part_time_chef"]);
  const supabase = await createServerSupabaseClient();
  const today = new Date();
  const from = new Date(today);
  const to = new Date(today);
  from.setFullYear(from.getFullYear() - 1);
  to.setFullYear(to.getFullYear() + 1);

  const [jobsResult, shiftsResult] = await Promise.all([
    supabase.rpc("get_my_workforce_jobs", {
      p_from_date: from.toISOString().slice(0, 10),
      p_to_date: to.toISOString().slice(0, 10),
    }),
    supabase
      .from("attendance_shifts")
      .select("id,booking_id,shift_date,started_at,ended_at,status")
      .eq("profile_id", session.profile.id)
      .order("started_at", { ascending: false })
      .limit(50),
  ]);

  if (jobsResult.error || shiftsResult.error) {
    return {
      ok: false,
      message: "Workforce data could not be loaded. Refresh the page and try again.",
    };
  }

  const jobs = z.array(jobRowSchema).safeParse(jobsResult.data ?? []);
  const shifts = z.array(shiftRowSchema).safeParse(shiftsResult.data ?? []);

  if (!jobs.success || !shifts.success) {
    return {
      ok: false,
      message: "Workforce data returned an unexpected format. Refresh and try again.",
    };
  }

  const mappedShifts = shifts.data.map(toShift);

  return {
    ok: true,
    data: {
      jobs: jobs.data.map(toJob),
      shifts: mappedShifts,
      openShift: mappedShifts.find((shift) => shift.status === "working") ?? null,
    },
  };
}
