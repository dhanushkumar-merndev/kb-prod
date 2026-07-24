"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";

import type { CrudActionState } from "@/features/core-crud/types";
import { requireActiveSession } from "@/lib/auth/require-session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import { bookingFormSchema, updateBookingFormSchema } from "./schemas";

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

function validationFailure(error: z.ZodError): CrudActionState {
  const fieldErrors: Record<string, string> = {};

  error.issues.forEach((issue) => {
    const field = issue.path[0];

    if (typeof field === "string" && !fieldErrors[field]) {
      fieldErrors[field] = issue.message;
    }
  });

  return failure("Check the highlighted fields and try again.", fieldErrors);
}

function databaseFailure(error: unknown): CrudActionState {
  const message =
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
      ? error.message
      : "UNKNOWN";
  const messages: Record<string, string> = {
    LEAD_NOT_READY_FOR_BOOKING: "Only a qualified lead can be converted.",
    LEAD_ALREADY_CONVERTED: "This lead already has a booking.",
    BOOKING_DETAILS_LOCKED: "Booking details are locked because service has started.",
    CONFLICT_STALE_VERSION: "This booking changed in another session. Refresh and try again.",
    PERMISSION_DENIED: "You do not have permission to change this booking.",
  };

  return failure(messages[message] ?? "We could not save the booking. Refresh and try again.");
}

function revalidateBookings(): void {
  [
    "/director/dashboard",
    "/director/bookings",
    "/manager/dashboard",
    "/manager/bookings",
    "/sales-manager/dashboard",
    "/sales-manager/bookings",
    "/sales/dashboard",
    "/sales/bookings",
    "/hr/booking-assignment",
  ].forEach((path) => revalidatePath(path));
}

export async function createBookingAction(
  _previousState: CrudActionState,
  formData: FormData,
): Promise<CrudActionState> {
  const session = await requireActiveSession();

  if (!["sales", "sales_manager"].includes(session.profile.role)) {
    return failure("You do not have permission to create a booking.");
  }

  const parsed = bookingFormSchema.safeParse(input(formData));

  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("create_booking_from_lead", {
    p_lead_id: parsed.data.leadId,
    p_event_type: parsed.data.eventType,
    p_event_date: parsed.data.eventDate,
    p_event_start_time: parsed.data.eventStartTime ?? null,
    p_reporting_time: parsed.data.reportingTime ?? null,
    p_venue: parsed.data.venue,
    p_guest_count: parsed.data.guestCount,
    p_menu: parsed.data.menu,
    p_instructions: parsed.data.instructions ?? null,
    p_total_value: parsed.data.totalValue,
  });

  if (error) {
    return databaseFailure(error);
  }

  revalidateBookings();
  return {
    status: "success",
    message: "Lead converted to booking.",
    mutationId: crypto.randomUUID(),
  };
}

export async function updateBookingAction(
  _previousState: CrudActionState,
  formData: FormData,
): Promise<CrudActionState> {
  const session = await requireActiveSession();

  if (!["director", "manager", "sales_manager", "sales"].includes(session.profile.role)) {
    return failure("You do not have permission to update a booking.");
  }

  const parsed = updateBookingFormSchema.safeParse(input(formData));

  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("update_booking_details", {
    p_booking_id: parsed.data.bookingId,
    p_expected_version: parsed.data.expectedVersion,
    p_event_type: parsed.data.eventType,
    p_event_date: parsed.data.eventDate,
    p_event_start_time: parsed.data.eventStartTime ?? null,
    p_reporting_time: parsed.data.reportingTime ?? null,
    p_venue: parsed.data.venue,
    p_guest_count: parsed.data.guestCount,
    p_menu: parsed.data.menu,
    p_instructions: parsed.data.instructions ?? null,
    p_total_value: parsed.data.totalValue,
  });

  if (error) {
    return databaseFailure(error);
  }

  revalidateBookings();
  return {
    status: "success",
    message: "Booking updated.",
    mutationId: crypto.randomUUID(),
  };
}
