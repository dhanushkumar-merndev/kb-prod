import "server-only";

import { z } from "zod";

import { requireRoleSession } from "@/lib/auth/require-role-session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const bookingSchema = z.object({
  booking_id: z.string().uuid(),
  booking_code: z.string(),
  event_type: z.string(),
  event_date: z.string(),
  venue: z.string(),
  service_status: z.string(),
  chef_profile_id: z.string().uuid().nullable(),
  chef_name: z.string().nullable(),
});

const chefSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string(),
  role: z.enum(["chef", "part_time_chef"]),
});

const shiftSchema = z.object({
  id: z.string().uuid(),
  profile_id: z.string().uuid().nullable(),
  temporary_worker_id: z.string().uuid().nullable(),
  booking_id: z.string().uuid().nullable(),
  shift_date: z.string(),
  started_at: z.string().nullable(),
  ended_at: z.string().nullable(),
  status: z.string(),
  overtime_minutes: z.number().int(),
  payroll_eligible: z.boolean(),
});

const namedProfileSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string(),
});

const attendanceProfileSchema = namedProfileSchema.extend({
  role: z.enum(["chef", "part_time_chef"]),
});

const attendanceBookingSchema = z.object({
  id: z.string().uuid(),
  booking_code: z.string(),
});

export async function loadAssignmentData() {
  await requireRoleSession(["director", "manager", "hr"]);
  const supabase = await createServerSupabaseClient();
  const today = new Date();
  const end = new Date(today);
  end.setFullYear(end.getFullYear() + 1);
  const [bookingResult, chefResult] = await Promise.all([
    supabase.rpc("get_workforce_bookings", {
      p_from_date: today.toISOString().slice(0, 10),
      p_to_date: end.toISOString().slice(0, 10),
    }),
    supabase
      .from("profiles")
      .select("id,full_name,role")
      .in("role", ["chef", "part_time_chef"])
      .eq("account_status", "active")
      .is("deleted_at", null)
      .order("full_name"),
  ]);

  const bookings = z.array(bookingSchema).safeParse(bookingResult.data ?? []);
  const chefs = z.array(chefSchema).safeParse(chefResult.data ?? []);

  if (bookingResult.error || chefResult.error || !bookings.success || !chefs.success) {
    return { ok: false as const, message: "Assignment data could not be loaded." };
  }

  return {
    ok: true as const,
    data: {
      bookings: bookings.data,
      chefs: chefs.data,
    },
  };
}

export async function loadAttendanceReviewData() {
  await requireRoleSession(["director", "manager", "hr"]);
  const supabase = await createServerSupabaseClient();
  const [shiftResult, profileResult, temporaryResult, bookingResult] = await Promise.all([
    supabase
      .from("attendance_shifts")
      .select(
        "id,profile_id,temporary_worker_id,booking_id,shift_date,started_at,ended_at,status,overtime_minutes,payroll_eligible",
      )
      .order("shift_date", { ascending: false })
      .limit(100),
    supabase
      .from("profiles")
      .select("id,full_name,role")
      .in("role", ["chef", "part_time_chef"])
      .is("deleted_at", null),
    supabase.from("temporary_workers").select("id,full_name").is("deleted_at", null),
    supabase
      .from("bookings")
      .select("id,booking_code")
      .is("deleted_at", null)
      .order("event_date", { ascending: false })
      .limit(500),
  ]);
  const shifts = z.array(shiftSchema).safeParse(shiftResult.data ?? []);
  const profiles = z.array(attendanceProfileSchema).safeParse(profileResult.data ?? []);
  const temporary = z.array(namedProfileSchema).safeParse(temporaryResult.data ?? []);
  const bookings = z.array(attendanceBookingSchema).safeParse(bookingResult.data ?? []);

  if (
    shiftResult.error ||
    profileResult.error ||
    temporaryResult.error ||
    bookingResult.error ||
    !shifts.success ||
    !profiles.success ||
    !temporary.success ||
    !bookings.success
  ) {
    return { ok: false as const, message: "Attendance data could not be loaded." };
  }

  const profileById = new Map(profiles.data.map((profile) => [profile.id, profile]));
  const temporaryById = new Map(temporary.data.map((worker) => [worker.id, worker]));
  const bookingById = new Map(bookings.data.map((booking) => [booking.id, booking]));

  return {
    ok: true as const,
    data: {
      shifts: shifts.data.map((shift) => {
        const profile = shift.profile_id ? profileById.get(shift.profile_id) : undefined;
        const temporaryWorker = shift.temporary_worker_id
          ? temporaryById.get(shift.temporary_worker_id)
          : undefined;
        const booking = shift.booking_id ? bookingById.get(shift.booking_id) : undefined;

        return {
          ...shift,
          worker_name: profile?.full_name ?? temporaryWorker?.full_name ?? "Worker",
          worker_type: (profile?.role ?? "temporary_worker") as
            | "chef"
            | "part_time_chef"
            | "temporary_worker",
          booking_code: booking?.booking_code ?? null,
        };
      }),
      workers: [
        ...profiles.data.map((profile) => ({
          value: `profile:${profile.id}`,
          name: profile.full_name,
          type: profile.role as "chef" | "part_time_chef",
        })),
        ...temporary.data.map((worker) => ({
          value: `temporary:${worker.id}`,
          name: worker.full_name,
          type: "temporary_worker" as const,
        })),
      ],
      bookings: bookings.data.map((booking) => ({
        id: booking.id,
        code: booking.booking_code,
      })),
    },
  };
}
