import { getAdminClient, requireActiveActor } from "../_shared/auth.ts";
import { sendBrevoEmail } from "../_shared/brevo.ts";
import { AppError, fromDatabaseError, toAppError } from "../_shared/errors.ts";
import { withEdgeRequest } from "../_shared/http.ts";
import { generateAndStoreInvoice } from "../_shared/invoice-pdf.ts";
import { formatInrAmount } from "../_shared/invoice-format.ts";

interface ClaimedEmail {
  attempt_count: number;
  booking_id: string;
  event_type: string;
  id: string;
  invoice_id: string | null;
  organization_id: string;
  recipient_email: string;
  recipient_name: string;
  subject: string;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new AppError("DATABASE_OPERATION_FAILED");
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, field: string): string {
  if (typeof value !== "string" || !value) {
    throw new AppError("DATABASE_OPERATION_FAILED", {
      details: { reason: `Missing ${field}.` },
    });
  }
  return value;
}

function claimedEmail(value: unknown): ClaimedEmail {
  const row = record(value);
  return {
    attempt_count: Number(row.attempt_count),
    booking_id: string(row.booking_id, "booking_id"),
    event_type: string(row.event_type, "event_type"),
    id: string(row.id, "id"),
    invoice_id: typeof row.invoice_id === "string" ? row.invoice_id : null,
    organization_id: string(row.organization_id, "organization_id"),
    recipient_email: string(row.recipient_email, "recipient_email"),
    recipient_name: string(row.recipient_name, "recipient_name"),
    subject: string(row.subject, "subject"),
  };
}

function constantTimeEqual(left: string, right: string): boolean {
  const maximum = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < maximum; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function serviceRoleAuthorized(request: Request): boolean {
  const expected = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ?? "";
  const supplied =
    request.headers
      .get("authorization")
      ?.replace(/^Bearer\s+/iu, "")
      .trim() ?? "";
  return Boolean(expected && supplied && constantTimeEqual(expected, supplied));
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function eventCopy(
  eventType: string,
  input: { balance: number; bookingCode: string; eventDate: string; total: number },
): { heading: string; message: string } {
  switch (eventType) {
    case "booking_payment_requested":
      return {
        heading: "Your booking invoice is ready",
        message: `Please review the attached invoice for ${input.bookingCode}. The total booking value is ${formatInrAmount(input.total)}.`,
      };
    case "invoice_reissued":
      return {
        heading: "Your updated invoice is ready",
        message: `An updated invoice for ${input.bookingCode} is attached.`,
      };
    case "booking_confirmed":
      return {
        heading: "Booking confirmed",
        message: `Your payment was verified and ${input.bookingCode} is confirmed for ${input.eventDate}.`,
      };
    case "payment_verified":
      return {
        heading: "Payment received",
        message: `We verified your payment for ${input.bookingCode}. The current balance is ${formatInrAmount(input.balance)}.`,
      };
    case "payment_rejected":
      return {
        heading: "Payment proof needs attention",
        message: `We could not verify the payment proof for ${input.bookingCode}. Please contact your Khana Banao representative and submit a clear proof.`,
      };
    case "balance_due":
      return {
        heading: "Service completed · balance due",
        message: `Service for ${input.bookingCode} is complete. The remaining balance is ${formatInrAmount(input.balance)}.`,
      };
    case "booking_completed":
      return {
        heading: "Booking completed",
        message: `${input.bookingCode} is fully paid and completed. Thank you for choosing Khana Banao.`,
      };
    default:
      throw new AppError("VALIDATION_FAILED");
  }
}

async function emailHtml(
  admin: ReturnType<typeof getAdminClient>,
  item: ClaimedEmail,
): Promise<string> {
  const bookingResult = await admin
    .from("bookings")
    .select("booking_code,event_date,event_type,total_value")
    .eq("id", item.booking_id)
    .eq("organization_id", item.organization_id)
    .single();
  if (bookingResult.error) throw fromDatabaseError(bookingResult.error);

  const paymentResult = await admin
    .from("booking_payments")
    .select("amount,payment_stage")
    .eq("booking_id", item.booking_id)
    .eq("organization_id", item.organization_id)
    .eq("verification_status", "verified");
  if (paymentResult.error) throw fromDatabaseError(paymentResult.error);

  const booking = record(bookingResult.data);
  const total = Number(booking.total_value);
  const verified = (paymentResult.data ?? []).reduce((sum, value) => {
    const payment = record(value);
    const amount = Number(payment.amount);
    return sum + (payment.payment_stage === "refund" ? -amount : amount);
  }, 0);
  const copy = eventCopy(item.event_type, {
    balance: Math.max(0, total - verified),
    bookingCode: string(booking.booking_code, "booking_code"),
    eventDate: string(booking.event_date, "event_date"),
    total,
  });

  return `<!doctype html>
<html lang="en">
  <body style="background:#f5f7fa;color:#0b2545;font-family:Arial,sans-serif;margin:0;padding:24px">
    <main style="background:#fff;border:1px solid #e1e6ef;border-radius:16px;margin:auto;max-width:620px;overflow:hidden">
      <header style="background:#0b2545;border-left:8px solid #f2701d;color:#fff;padding:24px 28px">
        <div style="font-size:22px;font-weight:700">Khana Banao</div>
        <div style="color:#ffd8bd;font-size:12px;margin-top:4px">Booking update</div>
      </header>
      <section style="padding:28px">
        <p style="margin-top:0">Hello ${escapeHtml(item.recipient_name)},</p>
        <h1 style="font-size:24px;margin:18px 0 12px">${escapeHtml(copy.heading)}</h1>
        <p style="font-size:15px;line-height:1.6">${escapeHtml(copy.message)}</p>
        <p style="background:#fff1e6;border-radius:10px;font-size:13px;line-height:1.5;padding:14px">
          This is an operational email about your Khana Banao booking. Reply to your sales representative if any detail needs correction.
        </p>
      </section>
    </main>
  </body>
</html>`;
}

function nextAttempt(attemptCount: number): string | null {
  const delays = [1, 5, 15, 60, 240];
  const delayMinutes = delays[attemptCount - 1];
  return delayMinutes === undefined
    ? null
    : new Date(Date.now() + delayMinutes * 60_000).toISOString();
}

async function processOne(
  admin: ReturnType<typeof getAdminClient>,
  item: ClaimedEmail,
): Promise<"failed" | "sent"> {
  try {
    const settingsResult = await admin
      .from("organization_settings")
      .select("customer_email_sender_email,customer_email_sender_name")
      .eq("organization_id", item.organization_id)
      .single();
    if (settingsResult.error) throw fromDatabaseError(settingsResult.error);
    const settings = record(settingsResult.data);
    const generated = item.invoice_id
      ? await generateAndStoreInvoice(admin, item.invoice_id)
      : null;
    const html = await emailHtml(admin, item);
    const providerMessageId = await sendBrevoEmail({
      ...(generated
        ? {
            attachment: {
              contentBase64: bytesToBase64(generated.bytes),
              name: generated.fileName,
            },
          }
        : {}),
      html,
      outboxId: item.id,
      recipientEmail: item.recipient_email,
      recipientName: item.recipient_name,
      ...(typeof settings.customer_email_sender_email === "string"
        ? { senderEmail: settings.customer_email_sender_email }
        : {}),
      ...(typeof settings.customer_email_sender_name === "string"
        ? { senderName: settings.customer_email_sender_name }
        : {}),
      subject: item.subject,
    });
    const update = await admin
      .from("email_outbox")
      .update({
        failed_at: null,
        last_error_safe: null,
        next_attempt_at: null,
        provider_message_id: providerMessageId,
        sent_at: new Date().toISOString(),
        status: "sent",
      })
      .eq("id", item.id)
      .eq("organization_id", item.organization_id)
      .eq("status", "processing");
    if (update.error) throw fromDatabaseError(update.error);
    return "sent";
  } catch (error) {
    const safe = toAppError(error);
    const retryable =
      safe.details?.retryable ??
      [
        "BREVO_RATE_LIMITED",
        "BREVO_PROVIDER_FAILED",
        "DATABASE_OPERATION_FAILED",
        "INTERNAL_ERROR",
      ].includes(safe.code);
    const retryAt = retryable && item.attempt_count < 5 ? nextAttempt(item.attempt_count) : null;
    await admin
      .from("email_outbox")
      .update({
        attempt_count: retryAt ? item.attempt_count : 5,
        failed_at: new Date().toISOString(),
        last_error_safe: safe.message,
        next_attempt_at: retryAt,
        status: "failed",
      })
      .eq("id", item.id)
      .eq("organization_id", item.organization_id);
    return "failed";
  }
}

Deno.serve((request) =>
  withEdgeRequest(request, async () => {
    const admin = getAdminClient();
    let organizationId: string | null = null;

    if (!serviceRoleAuthorized(request)) {
      const { profile: actor } = await requireActiveActor(request);
      if (actor.role !== "director") throw new AppError("PERMISSION_DENIED");
      organizationId = actor.organization_id;
    }

    const claim = await admin.rpc("claim_email_outbox", {
      p_limit: 25,
      p_organization_id: organizationId,
    });
    if (claim.error) throw fromDatabaseError(claim.error);
    const items = (claim.data ?? []).map(claimedEmail);

    let sent = 0;
    let failed = 0;
    for (const item of items) {
      const outcome = await processOne(admin, item);
      if (outcome === "sent") sent += 1;
      else failed += 1;
    }

    return { claimed: items.length, failed, sent };
  }),
);
