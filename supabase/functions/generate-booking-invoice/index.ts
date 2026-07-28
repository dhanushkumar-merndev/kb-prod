import { z } from "zod";
import { getAdminClient, requireActiveActor } from "../_shared/auth.ts";
import { AppError, fromDatabaseError } from "../_shared/errors.ts";
import { parseJson, withEdgeRequest } from "../_shared/http.ts";
import { generateAndStoreInvoice } from "../_shared/invoice-pdf.ts";

const schema = z.object({
  invoiceId: z.string().uuid(),
});

Deno.serve((request) =>
  withEdgeRequest(request, async () => {
    const { profile: actor } = await requireActiveActor(request);
    if (!["director", "manager", "sales_manager", "sales"].includes(actor.role)) {
      throw new AppError("PERMISSION_DENIED");
    }

    const input = await parseJson(request, schema);
    const admin = getAdminClient();
    const invoice = await admin
      .from("invoices")
      .select("id,booking_id,organization_id,bookings!inner(sold_by_profile_id)")
      .eq("id", input.invoiceId)
      .eq("organization_id", actor.organization_id)
      .maybeSingle();
    if (invoice.error) throw fromDatabaseError(invoice.error);
    if (!invoice.data) throw new AppError("NOT_FOUND");

    const row = invoice.data as Record<string, unknown>;
    const bookingValue = row.bookings;
    const bookingRow = Array.isArray(bookingValue) ? bookingValue[0] : bookingValue;
    const booking =
      typeof bookingRow === "object" && bookingRow !== null
        ? (bookingRow as Record<string, unknown>)
        : null;

    if (actor.role === "sales" && (!booking || booking.sold_by_profile_id !== actor.id)) {
      throw new AppError("PERMISSION_DENIED");
    }

    const generated = await generateAndStoreInvoice(admin, input.invoiceId);
    return {
      fileName: generated.fileName,
      generated: true,
      invoiceId: generated.invoiceId,
      invoiceNumber: generated.invoiceNumber,
    };
  }),
);
