import "server-only";

import { z } from "zod";

import { requireActiveSession } from "@/lib/auth/require-session";
import { ROLES } from "@/lib/constants/roles";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import type {
  ExpenseReviewRecord,
  LeaveReviewRecord,
  ReviewLoadResult,
} from "./types";

const expenseSchema = z.object({
  id: z.string().uuid(),
  submitted_by_profile_id: z.string().uuid(),
  booking_id: z.string().uuid().nullable(),
  category: z.string(),
  amount: z.union([z.string(), z.number()]).transform(String),
  reason: z.string(),
  status: z.enum(["pending", "verified", "approved", "rejected", "paid"]),
  rejection_reason: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

const attachmentSchema = z.object({
  id: z.string().uuid(),
  expense_id: z.string().uuid(),
  storage_path: z.string(),
  file_name: z.string(),
});

const profileSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string(),
  role: z.enum(ROLES),
});

const leaveSchema = z.object({
  id: z.string().uuid(),
  profile_id: z.string().uuid(),
  start_date: z.string(),
  end_date: z.string(),
  reason: z.string(),
  status: z.enum(["pending", "approved", "rejected", "cancelled"]),
  review_note: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

const bookingSchema = z.object({
  id: z.string().uuid(),
  booking_code: z.string(),
  event_date: z.string(),
  sold_by_profile_id: z.string().uuid(),
});

const assignmentSchema = z.object({
  booking_id: z.string().uuid(),
  chef_profile_id: z.string().uuid(),
  unassigned_at: z.string().nullable(),
});

const followUpSchema = z.object({
  assigned_profile_id: z.string().uuid(),
  due_at: z.string(),
  status: z.enum(["open", "completed", "cancelled", "overdue"]),
});

function failure(operation: string, error: unknown): ReviewLoadResult<never> {
  const requestId = crypto.randomUUID();
  const code =
    typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
      ? error.code
      : "UNKNOWN";

  console.error("[reviews]", { operation, requestId, code });

  return {
    ok: false,
    message: "Review records could not be loaded. Refresh the page and try again.",
    requestId,
  };
}

export async function loadExpenseReviews(): Promise<ReviewLoadResult<ExpenseReviewRecord>> {
  const session = await requireActiveSession();

  if (!["director", "manager", "hr"].includes(session.profile.role)) {
    return failure("expense-permission", { code: "42501" });
  }

  const supabase = await createServerSupabaseClient();
  const [expenseResult, profileResult] = await Promise.all([
    supabase
      .from("expenses")
      .select(
        "id,submitted_by_profile_id,booking_id,category,amount,reason,status,rejection_reason,created_at,updated_at",
      )
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("profiles")
      .select("id,full_name,role")
      .is("deleted_at", null)
      .order("full_name"),
  ]);

  if (expenseResult.error) {
    return failure("load-expenses", expenseResult.error);
  }

  if (profileResult.error) {
    return failure("load-expense-profiles", profileResult.error);
  }

  try {
    const expenses = z.array(expenseSchema).parse(expenseResult.data ?? []);
    const profiles = z.array(profileSchema).parse(profileResult.data ?? []);
    const expenseIds = expenses.map((expense) => expense.id);
    const attachmentResult =
      expenseIds.length === 0
        ? { data: [], error: null }
        : await supabase
            .from("expense_attachments")
            .select("id,expense_id,storage_path,file_name")
            .in("expense_id", expenseIds);

    if (attachmentResult.error) {
      return failure("load-review-attachments", attachmentResult.error);
    }

    const attachments = z.array(attachmentSchema).parse(attachmentResult.data ?? []);
    const signedResult =
      attachments.length === 0
        ? { data: [], error: null }
        : await supabase.storage
            .from("expense-bills")
            .createSignedUrls(
              attachments.map((attachment) => attachment.storage_path),
              300,
            );

    if (signedResult.error) {
      return failure("sign-review-attachments", signedResult.error);
    }

    const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
    const signedByPath = new Map(
      (signedResult.data ?? []).flatMap((entry) =>
        entry.path && entry.signedUrl ? [[entry.path, entry.signedUrl] as const] : [],
      ),
    );

    return {
      ok: true,
      viewerRole: session.profile.role,
      records: expenses.map((expense) => {
        const profile = profileById.get(expense.submitted_by_profile_id);

        return {
          id: expense.id,
          submitterName: profile?.full_name ?? "Team member",
          submitterRole: profile?.role ?? "chef",
          bookingId: expense.booking_id,
          category: expense.category,
          amount: expense.amount,
          reason: expense.reason,
          status: expense.status,
          rejectionReason: expense.rejection_reason,
          attachments: attachments.flatMap((attachment) => {
            if (attachment.expense_id !== expense.id) {
              return [];
            }

            const signedUrl = signedByPath.get(attachment.storage_path);
            return signedUrl
              ? [{ id: attachment.id, fileName: attachment.file_name, signedUrl }]
              : [];
          }),
          createdAt: expense.created_at,
          updatedAt: expense.updated_at,
        };
      }),
    };
  } catch (error) {
    return failure("parse-expense-reviews", error);
  }
}

export async function loadLeaveReviews(): Promise<ReviewLoadResult<LeaveReviewRecord>> {
  const session = await requireActiveSession();

  if (!["director", "manager", "hr", "sales_manager"].includes(session.profile.role)) {
    return failure("leave-permission", { code: "42501" });
  }

  const supabase = await createServerSupabaseClient();
  const [leaveResult, profileResult, bookingResult, assignmentResult, followUpResult] =
    await Promise.all([
      supabase
        .from("leave_requests")
        .select(
          "id,profile_id,start_date,end_date,reason,status,review_note,created_at,updated_at",
        )
        .order("created_at", { ascending: false })
        .limit(200),
      supabase
        .from("profiles")
        .select("id,full_name,role")
        .is("deleted_at", null)
        .order("full_name"),
      supabase
        .from("bookings")
        .select("id,booking_code,event_date,sold_by_profile_id")
        .is("deleted_at", null)
        .neq("service_status", "cancelled")
        .limit(500),
      supabase
        .from("booking_assignments")
        .select("booking_id,chef_profile_id,unassigned_at")
        .is("unassigned_at", null)
        .limit(500),
      supabase
        .from("follow_ups")
        .select("assigned_profile_id,due_at,status")
        .in("status", ["open", "overdue"])
        .limit(500),
    ]);

  const firstError = [
    leaveResult.error,
    profileResult.error,
    bookingResult.error,
    assignmentResult.error,
    followUpResult.error,
  ].find(Boolean);

  if (firstError) {
    return failure("load-leave-reviews", firstError);
  }

  try {
    const leaves = z.array(leaveSchema).parse(leaveResult.data ?? []);
    const profiles = z.array(profileSchema).parse(profileResult.data ?? []);
    const bookings = z.array(bookingSchema).parse(bookingResult.data ?? []);
    const assignments = z.array(assignmentSchema).parse(assignmentResult.data ?? []);
    const followUps = z.array(followUpSchema).parse(followUpResult.data ?? []);
    const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
    const bookingById = new Map(bookings.map((booking) => [booking.id, booking]));

    return {
      ok: true,
      viewerRole: session.profile.role,
      records: leaves.map((leave) => {
        const profile = profileById.get(leave.profile_id);
        const bookingConflicts = assignments.flatMap((assignment) => {
          if (assignment.chef_profile_id !== leave.profile_id) {
            return [];
          }

          const booking = bookingById.get(assignment.booking_id);

          return booking &&
            booking.event_date >= leave.start_date &&
            booking.event_date <= leave.end_date
            ? [`Assigned booking ${booking.booking_code} on ${booking.event_date}`]
            : [];
        });
        const salesBookingConflicts = bookings.flatMap((booking) =>
          booking.sold_by_profile_id === leave.profile_id &&
          booking.event_date >= leave.start_date &&
          booking.event_date <= leave.end_date
            ? [`Owned booking ${booking.booking_code} on ${booking.event_date}`]
            : [],
        );
        const followUpConflicts = followUps.flatMap((followUp) => {
          const dueDate = followUp.due_at.slice(0, 10);
          return followUp.assigned_profile_id === leave.profile_id &&
            dueDate >= leave.start_date &&
            dueDate <= leave.end_date
            ? [`Open follow-up due ${dueDate}`]
            : [];
        });

        return {
          id: leave.id,
          profileName: profile?.full_name ?? "Team member",
          profileRole: profile?.role ?? "chef",
          startDate: leave.start_date,
          endDate: leave.end_date,
          reason: leave.reason,
          status: leave.status,
          reviewNote: leave.review_note,
          conflictMessages: [
            ...new Set([...bookingConflicts, ...salesBookingConflicts, ...followUpConflicts]),
          ],
          createdAt: leave.created_at,
          updatedAt: leave.updated_at,
        };
      }),
    };
  } catch (error) {
    return failure("parse-leave-reviews", error);
  }
}
