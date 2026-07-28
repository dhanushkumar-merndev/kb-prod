"use server";

import { revalidatePath } from "next/cache";
import type { z } from "zod";

import type { CrudActionState } from "@/features/core-crud/types";
import { requireActiveSession } from "@/lib/auth/require-session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import {
  bookingCustomerEmailSchema,
  bookingFormSchema,
  bookingInvoiceSchema,
  reissueBookingInvoiceSchema,
  retryBookingEmailSchema,
  updateBookingFormSchema,
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
    ACTIVE_INVOICE_EXISTS: "This booking already has an active invoice.",
    INVOICE_NOT_FOUND: "The invoice could not be found. Refresh and try again.",
    INVOICE_REISSUE_REQUIRES_MANAGER:
      "A Manager or Sales Manager must reissue the invoice after financial details change.",
    INVALID_CUSTOMER_EMAIL: "Enter a valid customer email.",
    EMAIL_NOT_READY: "Enable email automation and add a customer email before retrying.",
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

function invoiceId(value: unknown): string | null {
  const row = Array.isArray(value) ? value[0] : value;
  return typeof row === "object" && row !== null && "id" in row && typeof row.id === "string"
    ? row.id
    : null;
}

function createdBookingId(value: unknown): string | null {
  const row = Array.isArray(value) ? value[0] : value;
  return typeof row === "object" &&
    row !== null &&
    "booking_id" in row &&
    typeof row.booking_id === "string"
    ? row.booking_id
    : null;
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
  const { data, error } = await supabase.rpc("create_booking_from_lead", {
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

  const bookingId = createdBookingId(data);

  revalidateBookings();
  return {
    status: "success",
    message: bookingId
      ? "Lead converted to payment-pending booking. Invoice is ready for local PDF download."
      : "Lead converted to payment-pending booking.",
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

export async function updateBookingCustomerEmailAction(
  _previousState: CrudActionState,
  formData: FormData,
): Promise<CrudActionState> {
  await requireActiveSession();
  const parsed = bookingCustomerEmailSchema.safeParse(input(formData));
  if (!parsed.success) return validationFailure(parsed.error);

  const supabase = await createServerSupabaseClient();
  const result = await supabase.rpc("update_booking_customer_email", {
    p_booking_id: parsed.data.bookingId,
    p_customer_email: parsed.data.customerEmail,
  });
  if (result.error) return databaseFailure(result.error);

  revalidateBookings();
  return {
    status: "success",
    message: "Customer email updated.",
    mutationId: crypto.randomUUID(),
  };
}

export async function issueBookingInvoiceAction(
  _previousState: CrudActionState,
  formData: FormData,
): Promise<CrudActionState> {
  await requireActiveSession();
  const parsed = bookingInvoiceSchema.safeParse(input(formData));
  if (!parsed.success) return validationFailure(parsed.error);

  const supabase = await createServerSupabaseClient();
  const result = await supabase.rpc("issue_booking_invoice", {
    p_booking_id: parsed.data.bookingId,
  });
  if (result.error) return databaseFailure(result.error);

  const id = invoiceId(result.data);
  if (!id) return failure("Invoice record could not be created.");

  revalidateBookings();
  return {
    status: "success",
    message: "Invoice is ready for local PDF download.",
    mutationId: crypto.randomUUID(),
  };
}

export async function reissueBookingInvoiceAction(
  _previousState: CrudActionState,
  formData: FormData,
): Promise<CrudActionState> {
  const session = await requireActiveSession();
  if (!["director", "manager", "sales_manager"].includes(session.profile.role)) {
    return failure("You do not have permission to reissue an invoice.");
  }
  const parsed = reissueBookingInvoiceSchema.safeParse(input(formData));
  if (!parsed.success) return validationFailure(parsed.error);

  const supabase = await createServerSupabaseClient();
  const result = await supabase.rpc("void_and_reissue_invoice", {
    p_invoice_id: parsed.data.bookingId,
    p_reason: parsed.data.reason,
  });
  if (result.error) return databaseFailure(result.error);

  const id = invoiceId(result.data);
  if (!id) return failure("Replacement invoice could not be created.");

  revalidateBookings();
  return {
    status: "success",
    message: "Invoice voided. The replacement is ready for local PDF download.",
    mutationId: crypto.randomUUID(),
  };
}

export async function resendBookingInvoiceAction(
  _previousState: CrudActionState,
  formData: FormData,
): Promise<CrudActionState> {
  await requireActiveSession();
  const parsed = bookingInvoiceSchema.safeParse(input(formData));
  if (!parsed.success) return validationFailure(parsed.error);

  const supabase = await createServerSupabaseClient();
  const result = await supabase.rpc("resend_booking_invoice", {
    p_invoice_id: parsed.data.bookingId,
    p_idempotency_key: crypto.randomUUID(),
  });
  if (result.error) return databaseFailure(result.error);

  revalidateBookings();
  return {
    status: "success",
    message: "Invoice email request recorded.",
    mutationId: crypto.randomUUID(),
  };
}

export async function retryBookingEmailAction(
  _previousState: CrudActionState,
  formData: FormData,
): Promise<CrudActionState> {
  await requireActiveSession();
  const parsed = retryBookingEmailSchema.safeParse(input(formData));
  if (!parsed.success) return validationFailure(parsed.error);

  const supabase = await createServerSupabaseClient();
  const result = await supabase.rpc("retry_customer_email", {
    p_outbox_id: parsed.data.outboxId,
  });
  if (result.error) return databaseFailure(result.error);

  revalidateBookings();
  return {
    status: "success",
    message: "Customer email queued for retry.",
    mutationId: crypto.randomUUID(),
  };
}
