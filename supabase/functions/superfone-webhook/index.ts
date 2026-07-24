import { getAdminClient } from "../_shared/auth.ts";
import { AppError, toAppError } from "../_shared/errors.ts";
import { withEdgeRequest } from "../_shared/http.ts";
import { reserveIntegrationEvent } from "../_shared/idempotency.ts";
import { createSuperfoneProvider } from "../_shared/superfone/adapter.ts";
import { applyVerifiedProviderEvent } from "../_shared/superfone/operations.ts";

Deno.serve((request) =>
  withEdgeRequest(request, async () => {
    const provider = createSuperfoneProvider();
    // The adapter reads and authenticates the raw request before parsing. The
    // pending adapter rejects this call until Superfone's official signature
    // header and signing algorithm are supplied.
    const verified = await provider.verifyWebhook(request);
    const admin = getAdminClient();
    const connection = await admin
      .from("integration_connections")
      .select("organization_id,status")
      .eq("provider", "superfone")
      .eq("account_identifier_safe", verified.accountIdentifierSafe)
      .eq("status", "connected")
      .maybeSingle();
    if (connection.error) {
      throw new AppError("DATABASE_OPERATION_FAILED", { cause: connection.error });
    }
    if (!connection.data) throw new AppError("SUPERFONE_WEBHOOK_INVALID");

    const organizationId = (connection.data as Record<string, unknown>).organization_id;
    if (typeof organizationId !== "string") throw new AppError("DATABASE_OPERATION_FAILED");

    const reservation = await reserveIntegrationEvent(admin, {
      organizationId,
      providerEventId: verified.providerEventId,
      eventType: verified.eventType,
      payload: verified.payloadSafe,
    });
    if (reservation.duplicate) {
      return {
        accepted: true,
        duplicate: true,
        eventId: reservation.eventId,
        status: reservation.status,
      };
    }

    await admin
      .from("integration_events")
      .update({ status: "processing", attempt_count: 1 })
      .eq("id", reservation.eventId)
      .eq("organization_id", organizationId);

    try {
      const entity = await applyVerifiedProviderEvent(admin, organizationId, verified);
      await admin
        .from("integration_events")
        .update({
          status: "processed",
          processed_at: new Date().toISOString(),
          last_error_safe: null,
        })
        .eq("id", reservation.eventId)
        .eq("organization_id", organizationId);
      return {
        accepted: true,
        duplicate: false,
        eventId: reservation.eventId,
        entity,
      };
    } catch (error) {
      const safeError = toAppError(error);
      await admin
        .from("integration_events")
        .update({
          status: "failed",
          processed_at: new Date().toISOString(),
          last_error_safe: safeError.message,
        })
        .eq("id", reservation.eventId)
        .eq("organization_id", organizationId);
      throw error;
    }
  }),
);
