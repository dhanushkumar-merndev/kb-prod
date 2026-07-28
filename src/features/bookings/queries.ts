import "server-only";

import { cache } from "react";
import { z } from "zod";

import { requireRoleSession } from "@/lib/auth/require-role-session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import type { BookingCrudData, BookingLeadOption, BookingRecord } from "./types";

const bookingRowSchema = z.object({
  id: z.string().uuid(),
  booking_code: z.string(),
  lead_id: z.string().uuid().nullable(),
  client_name: z.string(),
  customer_email: z.string().email().nullable(),
  event_type: z.string(),
  event_date: z.string(),
  event_start_time: z.string().nullable(),
  reporting_time: z.string().nullable(),
  venue: z.string(),
  guest_count: z.number().int(),
  menu: z.string(),
  instructions: z.string().nullable(),
  total_value: z.union([z.string(), z.number()]),
  payment_status: z.string(),
  service_status: z.enum([
    "pending",
    "confirmed",
    "chef_assigned",
    "preparing",
    "service_completed",
    "fully_completed",
    "cancelled",
  ]),
  version: z.number().int().positive(),
  invoice_id: z.string().uuid().nullable(),
  invoice_number: z.string().nullable(),
  invoice_status: z.enum(["pending_generation", "issued", "void", "generation_failed"]).nullable(),
  invoice_pdf_storage_path: z.string().nullable(),
  latest_email_id: z.string().uuid().nullable(),
  latest_email_status: z.string().nullable(),
  latest_email_error_safe: z.string().nullable(),
});

const leadRowSchema = z.object({
  id: z.string().uuid(),
  client_name: z.string(),
  customer_email: z.string().email().nullable(),
  event_date: z.string().nullable(),
  guest_count: z.number().int().nullable(),
  quote_amount: z.union([z.string(), z.number()]).nullable(),
});

const bookingPageSchema = z.object({
  bookings: z.array(bookingRowSchema),
  eligible_leads: z.array(leadRowSchema),
  total: z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/u)]),
});

function booking(row: z.infer<typeof bookingRowSchema>, downloadUrl: string | null): BookingRecord {
  return {
    id: row.id,
    bookingCode: row.booking_code,
    leadId: row.lead_id,
    clientName: row.client_name,
    customerEmail: row.customer_email,
    eventType: row.event_type,
    eventDate: row.event_date,
    eventStartTime: row.event_start_time,
    reportingTime: row.reporting_time,
    venue: row.venue,
    guestCount: row.guest_count,
    menu: row.menu,
    instructions: row.instructions,
    totalValue: String(row.total_value),
    paymentStatus: row.payment_status,
    serviceStatus: row.service_status,
    version: row.version,
    invoice:
      row.invoice_id && row.invoice_number && row.invoice_status
        ? {
            id: row.invoice_id,
            number: row.invoice_number,
            status: row.invoice_status,
            downloadUrl,
          }
        : null,
    latestEmail:
      row.latest_email_id && row.latest_email_status
        ? {
            id: row.latest_email_id,
            status: row.latest_email_status,
            error: row.latest_email_error_safe,
          }
        : null,
  };
}

function lead(row: z.infer<typeof leadRowSchema>): BookingLeadOption {
  return {
    id: row.id,
    clientName: row.client_name,
    customerEmail: row.customer_email,
    eventDate: row.event_date,
    guestCount: row.guest_count,
    quoteAmount: row.quote_amount === null ? null : String(row.quote_amount),
  };
}

export type BookingLoadResult =
  { ok: true; data: BookingCrudData } | { ok: false; message: string };

export const loadBookingCrudData = cache(async function loadBookingCrudData({
  page = 1,
  pageSize = 10,
  search = "",
}: {
  page?: number;
  pageSize?: number;
  search?: string;
} = {}): Promise<BookingLoadResult> {
  const session = await requireRoleSession(["director", "manager", "sales_manager", "sales"]);
  const supabase = await createServerSupabaseClient();
  const canCreate = ["sales", "sales_manager"].includes(session.profile.role);

  const cleanSearch = search.trim();
  const currentPage = Math.max(1, page);
  const result = await supabase.rpc("get_bookings_page", {
    p_page: currentPage,
    p_page_size: pageSize,
    p_search: cleanSearch || null,
  });

  if (result.error) {
    console.error("[bookings] optimized page query failed", {
      code: result.error.code,
    });
    return {
      ok: false,
      message: "Bookings could not be loaded. Refresh the page and try again.",
    };
  }

  const parsedPage = bookingPageSchema.safeParse(result.data);

  if (!parsedPage.success) {
    return {
      ok: false,
      message: "Booking data returned an unexpected format. Refresh and try again.",
    };
  }

  const bookings = await Promise.all(
    parsedPage.data.bookings.map(async (row) => {
      if (!row.invoice_pdf_storage_path || row.invoice_status !== "issued") {
        return booking(row, null);
      }

      const signed = await supabase.storage
        .from("invoices")
        .createSignedUrl(row.invoice_pdf_storage_path, 300);

      return booking(row, signed.error ? null : signed.data.signedUrl);
    }),
  );

  return {
    ok: true,
    data: {
      viewerRole: session.profile.role,
      bookings,
      eligibleLeads: canCreate ? parsedPage.data.eligible_leads.map(lead) : [],
      canCreate,
      total: Number(parsedPage.data.total),
      page: currentPage,
      pageSize,
      search: cleanSearch,
    },
  };
});
