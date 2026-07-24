import "server-only";

import { z } from "zod";

import { requireRoleSession } from "@/lib/auth/require-role-session";
import { createServerSupabaseClient } from "@/lib/supabase/server";

import type { PaymentBookingOption, PaymentData, PaymentRecord } from "./types";

const paymentRowSchema = z.object({
  id: z.string().uuid(),
  booking_id: z.string().uuid(),
  payment_stage: z.enum(["advance", "partial", "final", "full", "refund"]),
  amount: z.union([z.string(), z.number()]),
  payment_method: z.string().nullable(),
  transaction_reference: z.string().nullable(),
  proof_storage_path: z.string().nullable(),
  verification_status: z.enum(["pending", "verified", "rejected"]),
  rejection_reason: z.string().nullable(),
  paid_at: z.string().nullable(),
  created_at: z.string(),
});

const bookingRowSchema = z.object({
  id: z.string().uuid(),
  booking_code: z.string(),
  client_name: z.string(),
  total_value: z.union([z.string(), z.number()]),
  payment_status: z.string(),
});

export type PaymentLoadResult = { ok: true; data: PaymentData } | { ok: false; message: string };

export async function loadPaymentData(): Promise<PaymentLoadResult> {
  const session = await requireRoleSession(["director", "manager", "sales_manager", "sales"]);
  const supabase = await createServerSupabaseClient();
  const [paymentsResult, bookingsResult] = await Promise.all([
    supabase
      .from("booking_payments")
      .select(
        "id,booking_id,payment_stage,amount,payment_method,transaction_reference,proof_storage_path,verification_status,rejection_reason,paid_at,created_at",
      )
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("bookings")
      .select("id,booking_code,client_name,total_value,payment_status")
      .is("deleted_at", null)
      .order("event_date", { ascending: false })
      .limit(100),
  ]);

  if (paymentsResult.error || bookingsResult.error) {
    return {
      ok: false,
      message: "Payment data could not be loaded. Refresh and try again.",
    };
  }

  const payments = z.array(paymentRowSchema).safeParse(paymentsResult.data ?? []);
  const bookings = z.array(bookingRowSchema).safeParse(bookingsResult.data ?? []);

  if (!payments.success || !bookings.success) {
    return {
      ok: false,
      message: "Payment data returned an unexpected format. Refresh and try again.",
    };
  }

  const bookingCodes = new Map(bookings.data.map((booking) => [booking.id, booking.booking_code]));
  const proofPaths = payments.data.flatMap((payment) =>
    payment.proof_storage_path ? [payment.proof_storage_path] : [],
  );
  const signedResult =
    proofPaths.length === 0
      ? { data: [], error: null }
      : await supabase.storage.from("payment-proofs").createSignedUrls(proofPaths, 300);

  if (signedResult.error) {
    return {
      ok: false,
      message: "Payment proofs could not be prepared. Refresh and try again.",
    };
  }

  const signedUrlsByPath = new Map(
    (signedResult.data ?? []).flatMap((entry) =>
      entry.path && entry.signedUrl ? [[entry.path, entry.signedUrl] as const] : [],
    ),
  );
  const mappedPayments: PaymentRecord[] = payments.data.map((payment) => ({
    id: payment.id,
    bookingId: payment.booking_id,
    bookingCode: bookingCodes.get(payment.booking_id) ?? "Booking",
    paymentStage: payment.payment_stage,
    amount: String(payment.amount),
    paymentMethod: payment.payment_method,
    transactionReference: payment.transaction_reference,
    verificationStatus: payment.verification_status,
    rejectionReason: payment.rejection_reason,
    paidAt: payment.paid_at,
    createdAt: payment.created_at,
    proofUrl: payment.proof_storage_path
      ? (signedUrlsByPath.get(payment.proof_storage_path) ?? null)
      : null,
  }));
  const mappedBookings: PaymentBookingOption[] = bookings.data.map((booking) => ({
    id: booking.id,
    bookingCode: booking.booking_code,
    clientName: booking.client_name,
    totalValue: String(booking.total_value),
    paymentStatus: booking.payment_status,
  }));

  return {
    ok: true,
    data: {
      payments: mappedPayments,
      bookings: mappedBookings,
      canSubmit: ["sales", "sales_manager"].includes(session.profile.role),
      canReview: ["director", "manager", "sales_manager"].includes(session.profile.role),
    },
  };
}
